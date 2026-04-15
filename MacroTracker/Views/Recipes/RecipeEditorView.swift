import SwiftUI
import SwiftData

struct RecipeEditorView: View {
    @Environment(\.modelContext) private var modelContext
    @Bindable var recipe: Recipe

    @State private var showAddIngredient = false

    var body: some View {
        List {
            // Recipe info
            Section("Recipe Info") {
                HStack {
                    Text("Name")
                    Spacer()
                    TextField("Recipe name", text: $recipe.name)
                        .multilineTextAlignment(.trailing)
                }
                HStack {
                    Text("Servings")
                    Spacer()
                    TextField("1", value: $recipe.servings, format: .number)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 60)
                }
            }

            // Nutrition per serving
            Section("Per Serving") {
                NutritionLabelView(
                    calories: recipe.caloriesPerServing,
                    protein: recipe.proteinPerServing,
                    carbs: recipe.carbsPerServing,
                    fat: recipe.fatPerServing,
                    fiber: recipe.fiberPerServing
                )
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }

            // Ingredients
            Section {
                if recipe.ingredients.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "carrot")
                            .font(.title2)
                            .foregroundStyle(.tertiary)
                        Text("No ingredients yet")
                            .foregroundStyle(.secondary)
                            .font(.subheadline)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                } else {
                    ForEach(recipe.ingredients) { ingredient in
                        IngredientRow(ingredient: ingredient)
                    }
                    .onDelete(perform: deleteIngredients)
                }

                Button {
                    showAddIngredient = true
                } label: {
                    Label("Add Ingredient", systemImage: "plus")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(Color.accent, in: Capsule())
                }
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                .listRowBackground(Color.clear)
            } header: {
                HStack {
                    Text("Ingredients")
                    Spacer()
                    Text("Total: \(Int(recipe.totalCalories)) cal")
                        .font(.caption)
                        .foregroundStyle(Color.highlight)
                }
            }
        }
        .navigationTitle(recipe.name)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showAddIngredient) {
            IngredientSearchView { food, quantity in
                let ingredient = RecipeIngredient(food: food, quantity: quantity)
                ingredient.recipe = recipe
                modelContext.insert(ingredient)
                recipe.ingredients.append(ingredient)
                try? modelContext.save()
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            }
        }
    }

    private func deleteIngredients(at offsets: IndexSet) {
        for index in offsets {
            let ingredient = recipe.ingredients[index]
            recipe.ingredients.remove(at: index)
            modelContext.delete(ingredient)
        }
        try? modelContext.save()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}

private struct IngredientRow: View {
    @Bindable var ingredient: RecipeIngredient

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(ingredient.food?.name ?? "Unknown")
                    .font(.subheadline.weight(.medium))
                Text(String(format: "%.1f serving%@", ingredient.quantity, ingredient.quantity == 1 ? "" : "s"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(Int(ingredient.calories)) cal")
                    .font(.subheadline.bold())
                    .foregroundStyle(Color.highlight)
                HStack(spacing: 4) {
                    Text("P\(Int(ingredient.protein))")
                        .foregroundStyle(Color.accent)
                    Text("C\(Int(ingredient.carbs))")
                        .foregroundStyle(Color.highlight)
                    Text("F\(Int(ingredient.fat))")
                        .foregroundStyle(Color.fatColor)
                }
                .font(.system(size: 10, weight: .medium))
            }
        }
    }
}

// MARK: - Ingredient Search (simplified food search for recipes)

private struct IngredientSearchView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let onAdd: (Food, Double) -> Void

    @State private var searchText = ""
    @State private var apiResults: [FoodProduct] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?
    @State private var selectedFood: Food?
    @State private var quantity = "1"
    @State private var showCreateFood = false

    @Query(sort: \Food.createdAt, order: .reverse) private var allFoods: [Food]

    private var localFoods: [Food] {
        if searchText.isEmpty { return Array(allFoods.prefix(10)) }
        return allFoods.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    var body: some View {
        NavigationStack {
            if let food = selectedFood {
                // Quantity picker
                Form {
                    Section {
                        Text(food.name)
                            .font(.headline)
                        if !food.brand.isEmpty {
                            Text(food.brand)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Section("Servings") {
                        HStack {
                            TextField("1", text: $quantity)
                                .keyboardType(.decimalPad)
                                .frame(width: 60)
                            Text("servings (\(String(format: "%.0f", food.servingSize))\(food.servingUnit) each)")
                                .foregroundStyle(.secondary)
                        }
                    }

                    Section("Nutrition for \(quantity) serving\(quantity == "1" ? "" : "s")") {
                        let qty = Double(quantity) ?? 1
                        NutritionLabelView(
                            calories: food.calories * qty,
                            protein: food.protein * qty,
                            carbs: food.carbs * qty,
                            fat: food.fat * qty,
                            fiber: food.fiber * qty
                        )
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                }
                .navigationTitle("Add Ingredient")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Back") { selectedFood = nil }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Add") {
                            onAdd(food, Double(quantity) ?? 1)
                            dismiss()
                        }
                        .bold()
                    }
                }
            } else {
                // Search
                List {
                    Section {
                        Button {
                            showCreateFood = true
                        } label: {
                            Label("Create Food", systemImage: "plus.circle.fill")
                                .foregroundStyle(Color.accent)
                                .font(.subheadline.weight(.medium))
                        }
                    }

                    if !localFoods.isEmpty {
                        Section(searchText.isEmpty ? "Recent" : "My Foods") {
                            ForEach(localFoods) { food in
                                Button {
                                    selectedFood = food
                                } label: {
                                    HStack {
                                        Text(food.name)
                                            .font(.subheadline.weight(.medium))
                                        Spacer()
                                        Text("\(Int(food.calories)) cal")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(Color.highlight)
                                    }
                                }
                                .tint(.primary)
                            }
                        }
                    }

                    if !searchText.isEmpty {
                        Section("Search Results") {
                            if isSearching {
                                ProgressView()
                                    .tint(Color.accent)
                            } else {
                                ForEach(apiResults) { product in
                                    Button {
                                        let food = product.toFood()
                                        modelContext.insert(food)
                                        try? modelContext.save()
                                        selectedFood = food
                                    } label: {
                                        HStack {
                                            VStack(alignment: .leading) {
                                                Text(product.name)
                                                    .font(.subheadline.weight(.medium))
                                                    .lineLimit(1)
                                                if !product.brand.isEmpty {
                                                    Text(product.brand)
                                                        .font(.caption)
                                                        .foregroundStyle(.secondary)
                                                }
                                            }
                                            Spacer()
                                            Text("\(Int(product.calories)) cal")
                                                .font(.caption.weight(.semibold))
                                                .foregroundStyle(Color.highlight)
                                        }
                                    }
                                    .tint(.primary)
                                }
                            }
                        }
                    }
                }
                .searchable(text: $searchText, prompt: "Search foods...")
                .onChange(of: searchText) { _, newValue in
                    performSearch(query: newValue)
                }
                .navigationTitle("Add Ingredient")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                }
                .sheet(isPresented: $showCreateFood) {
                    CreateFoodView { food in
                        selectedFood = food
                    }
                }
            }
        }
    }

    private func performSearch(query: String) {
        searchTask?.cancel()
        guard !query.isEmpty else {
            apiResults = []
            return
        }
        searchTask = Task {
            isSearching = true
            defer { isSearching = false }
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }

            async let usdaSearch = USDAFoodService.shared.searchProducts(query: query)
            async let offSearch = OpenFoodFactsService.shared.searchProducts(query: query)

            var combined: [FoodProduct] = []
            if let usda = try? await usdaSearch, !Task.isCancelled {
                combined.append(contentsOf: usda)
            }
            if let off = try? await offSearch, !Task.isCancelled {
                combined.append(contentsOf: off)
            }
            if !Task.isCancelled { apiResults = combined }
        }
    }
}

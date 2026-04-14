import SwiftUI
import SwiftData

struct FoodSearchView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let mealType: MealType
    let date: Date

    @AppStorage("recent_searches") private var recentSearchesData: String = ""
    @State private var searchText = ""
    @State private var usdaResults: [FoodProduct] = []
    @State private var offResults: [FoodProduct] = []
    @State private var nutritionixResults: [NutritionixBrandedResult] = []
    @State private var isSearchingUSDA = false
    @State private var isSearchingOFF = false
    @State private var isSearchingNutritionix = false
    @State private var fetchingNixItemId: String?
    @State private var searchTask: Task<Void, Never>?
    @State private var showCreateFood = false
    @State private var showScanner = false
    @State private var selectedFood: Food?
    @State private var selectedRecipe: Recipe?
    @State private var usdaError: String?
    @State private var offError: String?
    @State private var nutritionixError: String?
    @State private var copiedPrompt = false

    @Query(sort: \Food.createdAt, order: .reverse) private var allFoods: [Food]
    @Query(sort: \Recipe.createdAt, order: .reverse) private var allRecipes: [Recipe]

    private var favoriteFoods: [Food] {
        allFoods.filter { $0.isFavorite }
    }

    private var localFoods: [Food] {
        if searchText.isEmpty { return Array(allFoods.prefix(10)) }
        return allFoods.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    private var localRecipes: [Recipe] {
        if searchText.isEmpty { return [] }
        return allRecipes.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    private var recentSearches: [String] {
        recentSearchesData.components(separatedBy: "|||").filter { !$0.isEmpty }
    }

    private var isSearching: Bool {
        isSearchingUSDA || isSearchingOFF || isSearchingNutritionix
    }

    var body: some View {
        NavigationStack {
            List {
                // Action buttons
                Section {
                    Button {
                        showScanner = true
                    } label: {
                        Label("Scan Barcode", systemImage: "barcode.viewfinder")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Color.highlight)
                    }

                    Button {
                        showCreateFood = true
                    } label: {
                        Label("Create Food", systemImage: "plus.circle")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Color.accent)
                    }
                }

                // Recent searches
                if searchText.isEmpty && !recentSearches.isEmpty {
                    Section("Recent Searches") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(recentSearches, id: \.self) { query in
                                    Button {
                                        searchText = query
                                    } label: {
                                        HStack(spacing: 4) {
                                            Image(systemName: "clock.arrow.circlepath")
                                                .font(.system(size: 9))
                                            Text(query)
                                                .font(.caption.weight(.medium))
                                        }
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                        .background(Color.accent.opacity(0.08))
                                        .foregroundStyle(Color.accent)
                                        .clipShape(Capsule())
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 4)
                        }
                        .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
                    }
                }

                // Favorites
                if searchText.isEmpty && !favoriteFoods.isEmpty {
                    Section("Favorites") {
                        ForEach(favoriteFoods) { food in
                            Button {
                                selectedFood = food
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "star.fill")
                                        .font(.caption2)
                                        .foregroundStyle(Color.highlight)
                                    FoodRow(
                                        name: food.name,
                                        detail: food.brand.isEmpty ? "\(Int(food.calories)) cal" : "\(food.brand) - \(Int(food.calories)) cal",
                                        calories: food.calories
                                    )
                                }
                            }
                            .tint(.primary)
                            .swipeActions(edge: .leading) {
                                Button {
                                    food.isFavorite = false
                                } label: {
                                    Label("Unfavorite", systemImage: "star.slash")
                                }
                                .tint(Color.highlight)
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    deleteFood(food)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                }

                // Local results
                if !localRecipes.isEmpty {
                    Section("Recipes") {
                        ForEach(localRecipes) { recipe in
                            Button {
                                addRecipeToDiary(recipe)
                            } label: {
                                FoodRow(
                                    name: recipe.name,
                                    detail: "\(Int(recipe.caloriesPerServing)) cal/serving",
                                    calories: recipe.caloriesPerServing
                                )
                            }
                            .tint(.primary)
                        }
                    }
                }

                if !localFoods.isEmpty {
                    Section(searchText.isEmpty ? "Recent Foods" : "My Foods") {
                        ForEach(localFoods) { food in
                            Button {
                                selectedFood = food
                            } label: {
                                HStack(spacing: 6) {
                                    if food.isFavorite {
                                        Image(systemName: "star.fill")
                                            .font(.caption2)
                                            .foregroundStyle(Color.highlight)
                                    }
                                    FoodRow(
                                        name: food.name,
                                        detail: food.brand.isEmpty ? "\(Int(food.calories)) cal" : "\(food.brand) - \(Int(food.calories)) cal",
                                        calories: food.calories
                                    )
                                }
                            }
                            .tint(.primary)
                            .swipeActions(edge: .leading) {
                                Button {
                                    food.isFavorite.toggle()
                                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                } label: {
                                    Label(
                                        food.isFavorite ? "Unfavorite" : "Favorite",
                                        systemImage: food.isFavorite ? "star.slash" : "star.fill"
                                    )
                                }
                                .tint(Color.highlight)
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    deleteFood(food)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                }

                // Nutritionix Restaurant & Chain Foods
                if !searchText.isEmpty && (isSearchingNutritionix || !nutritionixResults.isEmpty || nutritionixError != nil) {
                    Section {
                        if isSearchingNutritionix {
                            HStack {
                                ProgressView()
                                    .tint(Color.accent)
                                Text("Searching restaurants...")
                                    .foregroundStyle(.secondary)
                                    .font(.subheadline)
                            }
                        } else if let error = nutritionixError {
                            HStack {
                                Image(systemName: "exclamationmark.triangle")
                                    .foregroundStyle(.orange)
                                    .font(.caption)
                                Text(error)
                                    .foregroundStyle(.secondary)
                                    .font(.caption)
                                Spacer()
                                Button("Retry") {
                                    performSearch(query: searchText)
                                }
                                .font(.caption.bold())
                                .foregroundStyle(Color.accent)
                            }
                        } else {
                            ForEach(nutritionixResults) { item in
                                Button {
                                    fetchNutritionixDetails(item)
                                } label: {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(item.foodName)
                                                .font(.subheadline.weight(.medium))
                                                .lineLimit(1)
                                            Text("\(item.brandName) · \(formatQty(item.servingQty)) \(item.servingUnit)")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(1)
                                        }
                                        Spacer()
                                        if fetchingNixItemId == item.nixItemId {
                                            ProgressView()
                                                .controlSize(.small)
                                        } else {
                                            Text("\(Int(item.calories))")
                                                .font(.subheadline.bold())
                                                .foregroundStyle(Color.highlight)
                                            Text("cal")
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                .tint(.primary)
                                .disabled(fetchingNixItemId != nil)
                            }
                        }
                    } header: {
                        HStack {
                            Text("Restaurant & Chain Foods")
                            Spacer()
                            if !nutritionixResults.isEmpty {
                                Text("\(nutritionixResults.count) results")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            Image(systemName: "fork.knife.circle")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                // USDA Branded Foods
                if !searchText.isEmpty {
                    Section {
                        if isSearchingUSDA {
                            HStack {
                                ProgressView()
                                    .tint(Color.accent)
                                Text("Searching USDA...")
                                    .foregroundStyle(.secondary)
                                    .font(.subheadline)
                            }
                        } else if let error = usdaError {
                            HStack {
                                Image(systemName: "exclamationmark.triangle")
                                    .foregroundStyle(.orange)
                                    .font(.caption)
                                Text(error)
                                    .foregroundStyle(.secondary)
                                    .font(.caption)
                                Spacer()
                                Button("Retry") {
                                    performSearch(query: searchText)
                                }
                                .font(.caption.bold())
                                .foregroundStyle(Color.accent)
                            }
                        } else if usdaResults.isEmpty {
                            Text("No USDA results")
                                .foregroundStyle(.secondary)
                                .font(.caption)
                        } else {
                            ForEach(usdaResults) { product in
                                Button {
                                    saveAndSelect(product)
                                } label: {
                                    FoodRow(
                                        name: product.name,
                                        detail: product.brand.isEmpty
                                            ? "\(Int(product.calories)) cal · \(product.servingSize)"
                                            : "\(product.brand) · \(product.servingSize)",
                                        calories: product.calories,
                                        sourceColor: Color.accent
                                    )
                                }
                                .tint(.primary)
                            }
                        }
                    } header: {
                        HStack {
                            Text("USDA Branded Foods")
                            Spacer()
                            if !usdaResults.isEmpty {
                                Text("\(usdaResults.count) results")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            Image(systemName: "building.columns")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                // OpenFoodFacts Results
                if !searchText.isEmpty {
                    Section {
                        if isSearchingOFF {
                            HStack {
                                ProgressView()
                                    .tint(Color.accent)
                                Text("Searching OpenFoodFacts...")
                                    .foregroundStyle(.secondary)
                                    .font(.subheadline)
                            }
                        } else if let error = offError {
                            HStack {
                                Image(systemName: "exclamationmark.triangle")
                                    .foregroundStyle(.orange)
                                    .font(.caption)
                                Text(error)
                                    .foregroundStyle(.secondary)
                                    .font(.caption)
                                Spacer()
                                Button("Retry") {
                                    performSearch(query: searchText)
                                }
                                .font(.caption.bold())
                                .foregroundStyle(Color.accent)
                            }
                        } else if offResults.isEmpty {
                            Text("No OpenFoodFacts results")
                                .foregroundStyle(.secondary)
                                .font(.caption)
                        } else {
                            ForEach(offResults) { product in
                                Button {
                                    saveAndSelect(product)
                                } label: {
                                    FoodRow(
                                        name: product.name,
                                        detail: product.brand.isEmpty
                                            ? "\(Int(product.calories)) cal · \(product.servingSize)"
                                            : "\(product.brand) · \(product.servingSize)",
                                        calories: product.calories,
                                        sourceColor: .blue
                                    )
                                }
                                .tint(.primary)
                            }
                        }
                    } header: {
                        HStack {
                            Text("OpenFoodFacts")
                            Spacer()
                            if !offResults.isEmpty {
                                Text("\(offResults.count) results")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            Image(systemName: "globe")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                // Copy prompt for Claude fallback
                if !searchText.isEmpty && !isSearching {
                    Section {
                        Button {
                            let prompt = """
                            What are the approximate nutritional values per serving of "\(searchText.trimmingCharacters(in: .whitespaces))"?
                            Please format as:
                            Food: [name]
                            Serving: [amount]
                            Calories: [X]
                            Protein: [X]g
                            Carbs: [X]g
                            Fat: [X]g
                            """
                            UIPasteboard.general.string = prompt
                            UINotificationFeedbackGenerator().notificationOccurred(.success)
                            copiedPrompt = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                copiedPrompt = false
                            }
                        } label: {
                            if copiedPrompt {
                                Label("Copied!", systemImage: "checkmark")
                                    .foregroundStyle(Color.accent)
                            } else {
                                Label("Copy prompt for Claude", systemImage: "doc.on.clipboard")
                                    .foregroundStyle(Color.accent)
                            }
                        }
                    } header: {
                        Text("Can't find what you're looking for?")
                    } footer: {
                        Text("Paste this prompt into Claude to get estimated nutrition info.")
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search foods...")
            .onChange(of: searchText) { _, newValue in
                performSearch(query: newValue)
            }
            .navigationTitle("Add to \(mealType.rawValue)")
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
            .sheet(isPresented: $showScanner) {
                BarcodeScannerView { food in
                    selectedFood = food
                }
            }
            .navigationDestination(item: $selectedFood) { food in
                FoodDetailView(food: food, mealType: mealType, date: date)
            }
        }
    }

    // MARK: - Parallel Search

    private func performSearch(query: String) {
        searchTask?.cancel()
        usdaError = nil
        offError = nil
        nutritionixError = nil

        guard !query.isEmpty else {
            usdaResults = []
            offResults = []
            nutritionixResults = []
            return
        }

        searchTask = Task {
            isSearchingUSDA = true
            isSearchingOFF = true
            let nixConfigured = await NutritionixService.shared.isConfigured
            if nixConfigured { isSearchingNutritionix = true }

            try? await Task.sleep(for: .milliseconds(400)) // debounce
            guard !Task.isCancelled else { return }

            // Save to recent searches
            saveRecentSearch(query)

            // Fire all API searches in parallel
            async let usdaSearch = USDAFoodService.shared.searchProducts(query: query)
            async let offSearch = OpenFoodFactsService.shared.searchProducts(query: query)

            // Nutritionix (only if configured)
            if nixConfigured {
                do {
                    let nix = try await NutritionixService.shared.searchBranded(query: query)
                    if !Task.isCancelled { nutritionixResults = nix }
                } catch {
                    if !Task.isCancelled {
                        nutritionixError = "Restaurant search failed."
                        nutritionixResults = []
                    }
                }
                isSearchingNutritionix = false
            } else {
                nutritionixResults = []
                isSearchingNutritionix = false
            }

            // Collect USDA results
            do {
                let usda = try await usdaSearch
                if !Task.isCancelled { usdaResults = usda }
            } catch {
                if !Task.isCancelled {
                    usdaError = "USDA search failed."
                    usdaResults = []
                }
            }
            isSearchingUSDA = false

            // Collect OpenFoodFacts results
            do {
                let off = try await offSearch
                if !Task.isCancelled { offResults = off }
            } catch {
                if !Task.isCancelled {
                    offError = "OpenFoodFacts search failed."
                    offResults = []
                }
            }
            isSearchingOFF = false
        }
    }

    private func saveAndSelect(_ product: FoodProduct) {
        let food = product.toFood()
        modelContext.insert(food)
        try? modelContext.save()
        selectedFood = food
    }

    private func fetchNutritionixDetails(_ item: NutritionixBrandedResult) {
        fetchingNixItemId = item.nixItemId
        Task {
            do {
                if let product = try await NutritionixService.shared.getItemDetails(nixItemId: item.nixItemId) {
                    saveAndSelect(product)
                }
            } catch {
                // Silently fail — user can tap again
            }
            fetchingNixItemId = nil
        }
    }

    private func formatQty(_ qty: Double) -> String {
        qty.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", qty)
            : String(format: "%.1f", qty)
    }

    private func saveRecentSearch(_ query: String) {
        var searches = recentSearches.filter { $0 != query }
        searches.insert(query, at: 0)
        if searches.count > 5 { searches = Array(searches.prefix(5)) }
        recentSearchesData = searches.joined(separator: "|||")
    }

    private func deleteFood(_ food: Food) {
        modelContext.delete(food)
        try? modelContext.save()
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    private func addRecipeToDiary(_ recipe: Recipe) {
        let entry = DiaryEntry(
            date: date,
            mealType: mealType,
            recipe: recipe,
            numberOfServings: 1
        )
        modelContext.insert(entry)
        try? modelContext.save()
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        dismiss()
    }
}

private struct FoodRow: View {
    let name: String
    let detail: String
    let calories: Double
    var sourceColor: Color?

    var body: some View {
        HStack(spacing: 8) {
            if let color = sourceColor {
                RoundedRectangle(cornerRadius: 2)
                    .fill(color)
                    .frame(width: 3, height: 32)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Text("\(Int(calories))")
                .font(.subheadline.bold())
                .foregroundStyle(Color.highlight)
            Text("cal")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

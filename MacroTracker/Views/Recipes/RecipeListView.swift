import SwiftUI
import SwiftData

struct RecipeListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Recipe.createdAt, order: .reverse) private var recipes: [Recipe]

    @State private var showCreateRecipe = false

    var body: some View {
        NavigationStack {
            Group {
                if recipes.isEmpty {
                    ContentUnavailableView(
                        "No Recipes",
                        systemImage: "frying.pan",
                        description: Text("Create recipes to quickly log meals with multiple ingredients.")
                    )
                } else {
                    List {
                        ForEach(recipes) { recipe in
                            NavigationLink {
                                RecipeEditorView(recipe: recipe)
                            } label: {
                                RecipeRow(recipe: recipe)
                            }
                        }
                        .onDelete(perform: deleteRecipes)
                    }
                }
            }
            .navigationTitle("Recipes")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showCreateRecipe = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showCreateRecipe) {
                NewRecipeSheet { name, servings in
                    let recipe = Recipe(name: name, servings: servings)
                    modelContext.insert(recipe)
                    showCreateRecipe = false
                }
            }
        }
    }

    private func deleteRecipes(at offsets: IndexSet) {
        for index in offsets {
            modelContext.delete(recipes[index])
        }
    }
}

private struct RecipeRow: View {
    let recipe: Recipe

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(recipe.name)
                .font(.headline)
            HStack(spacing: 12) {
                Text("\(Int(recipe.caloriesPerServing)) cal")
                    .foregroundStyle(Color.hermesOrange)
                    .fontWeight(.medium)
                Text("P: \(Int(recipe.proteinPerServing))g")
                    .foregroundStyle(Color.royalBlue)
                Text("C: \(Int(recipe.carbsPerServing))g")
                    .foregroundStyle(Color.hermesOrange)
                Text("F: \(Int(recipe.fatPerServing))g")
                    .foregroundStyle(.pink)
            }
            .font(.caption)

            Text("\(recipe.ingredients.count) ingredient\(recipe.ingredients.count == 1 ? "" : "s") \u{00B7} \(String(format: "%.0f", recipe.servings)) serving\(recipe.servings == 1 ? "" : "s")")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct NewRecipeSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var servings = "1"
    let onCreate: (String, Double) -> Void

    var body: some View {
        NavigationStack {
            Form {
                TextField("Recipe Name", text: $name)
                HStack {
                    Text("Servings")
                    Spacer()
                    TextField("1", text: $servings)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 60)
                }
            }
            .navigationTitle("New Recipe")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        onCreate(name, Double(servings) ?? 1)
                    }
                    .disabled(name.isEmpty)
                    .bold()
                }
            }
        }
    }
}

import SwiftUI
import SwiftData

struct FoodDetailView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let food: Food
    let mealType: MealType
    let date: Date

    @State private var servings: Double = 1
    @State private var didAdd = false
    @State private var editedServingSize: String = ""
    @State private var editedServingUnit: String = ""

    private let availableUnits = ["g", "ml", "oz", "cup", "tbsp", "tsp", "piece", "slice"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // Food header
                    VStack(spacing: 6) {
                        Text(food.name)
                            .font(.title2.bold())
                        if !food.brand.isEmpty {
                            Text(food.brand)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.top)

                    // Serving size editor
                    VStack(spacing: 10) {
                        Text("Serving Size")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                            .tracking(0.5)

                        HStack(spacing: 12) {
                            TextField("100", text: $editedServingSize)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.center)
                                .font(.title3.weight(.semibold))
                                .frame(width: 70)
                                .padding(.vertical, 8)
                                .padding(.horizontal, 12)
                                .background(Color.cardBackground)
                                .clipShape(RoundedRectangle(cornerRadius: 10))

                            Picker("Unit", selection: $editedServingUnit) {
                                ForEach(availableUnits, id: \.self) { unit in
                                    Text(unit).tag(unit)
                                }
                            }
                            .pickerStyle(.menu)
                            .tint(Color.accent)
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(Color.cardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal)
                    .onChange(of: editedServingSize) { _, newValue in
                        if let size = Double(newValue) {
                            food.servingSize = size
                        }
                    }
                    .onChange(of: editedServingUnit) { _, newValue in
                        food.servingUnit = newValue
                    }

                    // Nutrition summary
                    NutritionLabelView(
                        calories: food.calories * servings,
                        protein: food.protein * servings,
                        carbs: food.carbs * servings,
                        fat: food.fat * servings
                    )
                    .padding(.horizontal)

                    // Serving count selector
                    VStack(spacing: 8) {
                        Text("Number of Servings")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                            .tracking(0.5)

                        HStack(spacing: 20) {
                            Button {
                                if servings > 0.5 { servings -= 0.5 }
                            } label: {
                                Image(systemName: "minus.circle.fill")
                                    .font(.title2)
                            }

                            Text(String(format: "%.1f", servings))
                                .font(.system(size: 28, weight: .bold, design: .rounded))
                                .frame(width: 60)

                            Button {
                                servings += 0.5
                            } label: {
                                Image(systemName: "plus.circle.fill")
                                    .font(.title2)
                            }
                        }
                        .tint(Color.accent)
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(Color.cardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal)

                    // Add button
                    Button {
                        addToDiary()
                    } label: {
                        Label(didAdd ? "Added!" : "Add to \(mealType.rawValue)", systemImage: didAdd ? "checkmark.circle.fill" : "plus.circle.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(didAdd ? Color.gray : Color.accent)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(didAdd)
                    .padding(.horizontal)
                    .padding(.bottom)
                }
            }
            .background(Color.surfaceBackground)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .onAppear {
                editedServingSize = String(format: "%.0f", food.servingSize)
                editedServingUnit = food.servingUnit
            }
        }
    }

    private func addToDiary() {
        let entry = DiaryEntry(
            date: date,
            mealType: mealType,
            food: food,
            numberOfServings: servings
        )
        modelContext.insert(entry)
        didAdd = true
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            dismiss()
        }
    }
}

import SwiftUI
import SwiftData

struct FoodDetailView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let food: Food
    let mealType: MealType
    let date: Date

    @State private var customAmount: String = ""
    @State private var servingsText: String = "1"
    @State private var didAdd = false

    @FocusState private var amountFocused: Bool
    @FocusState private var servingsFocused: Bool

    // MARK: - Computed

    /// Ratio of custom amount to original serving size
    private var amountRatio: Double {
        let amount = Double(customAmount) ?? food.servingSize
        guard food.servingSize > 0 else { return 1 }
        return amount / food.servingSize
    }

    private var servingsCount: Double {
        Double(servingsText) ?? 1
    }

    /// Combined multiplier applied to base nutrition
    private var effectiveMultiplier: Double {
        amountRatio * servingsCount
    }

    private let quickServings: [Double] = [0.25, 0.5, 1, 1.5, 2, 3]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Food header
                VStack(spacing: 6) {
                    Text(food.name)
                        .font(.title2.bold())
                        .multilineTextAlignment(.center)
                    if !food.brand.isEmpty {
                        Text(food.brand)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.top)

                // Original serving reference
                HStack(spacing: 6) {
                    Image(systemName: "info.circle")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    Text("1 serving = \(formattedServingSize) \(food.servingUnit)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                // Amount input
                VStack(spacing: 10) {
                    Text("Amount")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .tracking(0.5)

                    HStack(spacing: 8) {
                        TextField(formattedServingSize, text: $customAmount)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.center)
                            .font(.system(size: 28, weight: .bold, design: .rounded))
                            .frame(minWidth: 80)
                            .padding(.vertical, 10)
                            .padding(.horizontal, 16)
                            .background(Color.surfaceBackground)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .focused($amountFocused)

                        Text(food.servingUnit)
                            .font(.title3.weight(.medium))
                            .foregroundStyle(.secondary)
                    }

                    // Show equivalent servings when amount differs from default
                    if abs(amountRatio - 1.0) > 0.01 {
                        Text("= \(String(format: "%.2f", amountRatio)) servings")
                            .font(.caption)
                            .foregroundStyle(Color.accent)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .padding(.horizontal)

                // Nutrition summary
                NutritionLabelView(
                    calories: food.calories * effectiveMultiplier,
                    protein: food.protein * effectiveMultiplier,
                    carbs: food.carbs * effectiveMultiplier,
                    fat: food.fat * effectiveMultiplier
                )
                .padding(.horizontal)
                .contentTransition(.numericText())
                .animation(.default, value: effectiveMultiplier)

                // Number of servings
                VStack(spacing: 12) {
                    Text("Number of Servings")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .tracking(0.5)

                    TextField("1", text: $servingsText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.center)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .frame(width: 100)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 16)
                        .background(Color.surfaceBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .focused($servingsFocused)

                    // Quick-select chips
                    HStack(spacing: 8) {
                        ForEach(quickServings, id: \.self) { value in
                            Button {
                                servingsText = formatNumber(value)
                                servingsFocused = false
                            } label: {
                                Text(formatNumber(value))
                                    .font(.subheadline.weight(.medium))
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 7)
                                    .background(
                                        servingsCount == value
                                            ? Color.accent
                                            : Color.surfaceBackground
                                    )
                                    .foregroundStyle(
                                        servingsCount == value
                                            ? .white
                                            : .primary
                                    )
                                    .clipShape(Capsule())
                            }
                        }
                    }

                    // Total amount summary
                    let totalAmount = (Double(customAmount) ?? food.servingSize) * servingsCount
                    if servingsCount != 1 {
                        Text("Total: \(String(format: "%.0f", totalAmount)) \(food.servingUnit)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
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
                    Label(
                        didAdd ? "Added!" : "Add to \(mealType.rawValue)",
                        systemImage: didAdd ? "checkmark.circle.fill" : "plus.circle.fill"
                    )
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
        .onAppear {
            customAmount = formattedServingSize
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    amountFocused = false
                    servingsFocused = false
                }
                .font(.subheadline.bold())
            }
        }
    }

    // MARK: - Helpers

    private var formattedServingSize: String {
        food.servingSize.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", food.servingSize)
            : String(format: "%.1f", food.servingSize)
    }

    private func formatNumber(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", value)
            : String(value)
    }

    private func addToDiary() {
        let entry = DiaryEntry(
            date: date,
            mealType: mealType,
            food: food,
            numberOfServings: effectiveMultiplier
        )
        modelContext.insert(entry)
        try? modelContext.save()
        didAdd = true
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            dismiss()
        }
    }
}

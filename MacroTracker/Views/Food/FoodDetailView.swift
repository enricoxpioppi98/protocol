import SwiftUI
import SwiftData

// MARK: - Unit Conversion

private enum UnitConversion {
    static let volumeUnits = ["ml", "L", "cup", "tbsp", "tsp"]
    static let weightUnits = ["g", "kg", "oz", "lb"]
    static let countUnits  = ["piece", "slice", "serving"]

    /// Factor to convert 1 of this unit into the base unit (ml for volume, g for weight, 1 for count).
    static let toBase: [String: Double] = [
        "ml": 1,        "L": 1000,     "cup": 236.588,
        "tbsp": 14.787, "tsp": 4.929,
        "g": 1,         "kg": 1000,    "oz": 28.3495,  "lb": 453.592,
        "piece": 1,     "slice": 1,    "serving": 1
    ]

    enum Group { case volume, weight, count }

    static func group(for unit: String) -> Group {
        let u = unit.lowercased()
        if volumeUnits.contains(u) { return .volume }
        if weightUnits.contains(u) { return .weight }
        return .count
    }

    /// Units the user can switch to from the given unit.
    static func compatibleUnits(for unit: String) -> [String] {
        switch group(for: unit.lowercased()) {
        case .volume:  return volumeUnits
        case .weight:  return weightUnits
        case .count:   return countUnits
        }
    }

    /// Convert an amount from one unit to another within the same group.
    /// Returns `nil` when the units are incompatible.
    static func convert(_ amount: Double, from: String, to: String) -> Double? {
        let f = from.lowercased()
        let t = to.lowercased()
        guard group(for: f) == group(for: t),
              let fromFactor = toBase[f],
              let toFactor = toBase[t],
              toFactor > 0 else { return nil }
        return amount * fromFactor / toFactor
    }
}

// MARK: - FoodDetailView

struct FoodDetailView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let food: Food
    let mealType: MealType
    let date: Date

    @State private var customAmount: String = ""
    @State private var selectedUnit: String = ""
    @State private var servingsText: String = "1"
    @State private var didAdd = false

    @FocusState private var amountFocused: Bool
    @FocusState private var servingsFocused: Bool

    // MARK: - Computed

    /// The amount expressed in the food's original unit, for ratio calculation.
    private var amountInOriginalUnit: Double {
        let amount = Double(customAmount) ?? food.servingSize
        if selectedUnit.lowercased() == food.servingUnit.lowercased() {
            return amount
        }
        return UnitConversion.convert(amount, from: selectedUnit, to: food.servingUnit) ?? amount
    }

    private var amountRatio: Double {
        guard food.servingSize > 0 else { return 1 }
        return amountInOriginalUnit / food.servingSize
    }

    private var servingsCount: Double {
        Double(servingsText) ?? 1
    }

    private var effectiveMultiplier: Double {
        amountRatio * servingsCount
    }

    private var compatibleUnits: [String] {
        UnitConversion.compatibleUnits(for: food.servingUnit)
    }

    private var canConvertUnits: Bool {
        compatibleUnits.count > 1
    }

    private let quickServings: [Double] = [0.25, 0.5, 1, 1.5, 2, 3]

    // MARK: - Body

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
                    Text("1 serving = \(formattedOriginalSize) \(food.servingUnit)")
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
                        TextField(formattedOriginalSize, text: $customAmount)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.center)
                            .font(.system(size: 28, weight: .bold, design: .rounded))
                            .frame(minWidth: 80)
                            .padding(.vertical, 10)
                            .padding(.horizontal, 16)
                            .background(Color.surfaceBackground)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .focused($amountFocused)

                        if canConvertUnits {
                            Picker("Unit", selection: $selectedUnit) {
                                ForEach(compatibleUnits, id: \.self) { unit in
                                    Text(unit).tag(unit)
                                }
                            }
                            .pickerStyle(.menu)
                            .font(.title3.weight(.medium))
                            .tint(Color.accent)
                        } else {
                            Text(selectedUnit)
                                .font(.title3.weight(.medium))
                                .foregroundStyle(.secondary)
                        }
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
                        Text("Total: \(String(format: "%.0f", totalAmount)) \(selectedUnit)")
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
            selectedUnit = food.servingUnit.lowercased()
            customAmount = formattedOriginalSize
        }
        .onChange(of: selectedUnit) { oldUnit, newUnit in
            convertAmount(from: oldUnit, to: newUnit)
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

    private var formattedOriginalSize: String {
        food.servingSize.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", food.servingSize)
            : String(format: "%.1f", food.servingSize)
    }

    private func formatNumber(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", value)
            : String(value)
    }

    /// When the user picks a new unit, convert the current amount so the
    /// physical quantity stays the same (e.g. 1 cup → 236.6 ml).
    private func convertAmount(from oldUnit: String, to newUnit: String) {
        guard oldUnit != newUnit else { return }
        let currentAmount = Double(customAmount) ?? food.servingSize
        if let converted = UnitConversion.convert(currentAmount, from: oldUnit, to: newUnit) {
            // Show a sensible number of decimals
            if converted >= 10 {
                customAmount = String(format: "%.0f", converted)
            } else if converted >= 1 {
                customAmount = String(format: "%.1f", converted)
            } else {
                customAmount = String(format: "%.2f", converted)
            }
        }
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

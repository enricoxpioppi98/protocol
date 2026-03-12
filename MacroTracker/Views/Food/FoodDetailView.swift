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
    @State private var selectedServings: Double = 1.0
    @State private var didAdd = false

    @FocusState private var amountFocused: Bool

    /// Values available in the wheel picker
    private static let servingOptions: [Double] = {
        var values: [Double] = []
        // 0.25 to 5.0 in 0.25 steps
        var v = 0.25
        while v <= 5.0 {
            values.append(v)
            v += 0.25
        }
        // 5.5 to 10 in 0.5 steps
        v = 5.5
        while v <= 10.0 {
            values.append(v)
            v += 0.5
        }
        return values
    }()

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

    private var effectiveMultiplier: Double {
        amountRatio * selectedServings
    }

    private var compatibleUnits: [String] {
        UnitConversion.compatibleUnits(for: food.servingUnit)
    }

    private var canConvertUnits: Bool {
        compatibleUnits.count > 1
    }

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

                // Number of servings — wheel picker
                VStack(spacing: 4) {
                    Text("Number of Servings")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .tracking(0.5)

                    Picker("Servings", selection: $selectedServings) {
                        ForEach(Self.servingOptions, id: \.self) { value in
                            Text(formatNumber(value))
                                .tag(value)
                        }
                    }
                    .pickerStyle(.wheel)
                    .frame(height: 120)

                    // Total amount summary
                    let totalAmount = (Double(customAmount) ?? food.servingSize) * selectedServings
                    if selectedServings != 1 {
                        Text("Total: \(String(format: "%.0f", totalAmount)) \(selectedUnit)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
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

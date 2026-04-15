import SwiftUI
import SwiftData

struct CreateFoodView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var brand = ""
    @State private var barcode = ""
    @State private var calories = ""
    @State private var protein = ""
    @State private var carbs = ""
    @State private var fat = ""
    @State private var fiber = ""
    @State private var servingSize = "100"
    @State private var servingUnit = "g"

    let onSaved: ((Food) -> Void)?

    init(onSaved: ((Food) -> Void)? = nil) {
        self.onSaved = onSaved
    }

    private var isValid: Bool {
        !name.isEmpty && Double(calories) != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Food Info") {
                    TextField("Name", text: $name)
                    TextField("Brand (optional)", text: $brand)
                    TextField("Barcode (optional)", text: $barcode)
                        .keyboardType(.numberPad)
                }

                Section("Nutrition per Serving") {
                    NutritionField(label: "Calories", value: $calories, unit: "kcal", color: Color.highlight)
                    NutritionField(label: "Protein", value: $protein, unit: "g", color: Color.accent)
                    NutritionField(label: "Carbs", value: $carbs, unit: "g", color: Color.highlight)
                    NutritionField(label: "Fat", value: $fat, unit: "g", color: .pink)
                    NutritionField(label: "Fiber", value: $fiber, unit: "g", color: Color(red: 0.19, green: 0.82, blue: 0.35))

                    if !name.isEmpty {
                        Button {
                            let prompt = "Estimate nutritional values per serving of \(name). Format: Calories: X, Protein: Xg, Carbs: Xg, Fat: Xg, Fiber: Xg"
                            UIPasteboard.general.string = prompt
                            UINotificationFeedbackGenerator().notificationOccurred(.success)
                        } label: {
                            Label("Estimate with AI", systemImage: "sparkles")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Color(red: 0.19, green: 0.82, blue: 0.35))
                        }
                    }
                }

                Section("Serving Size") {
                    HStack {
                        TextField("Amount", text: $servingSize)
                            .keyboardType(.decimalPad)
                            .frame(width: 80)
                        Picker("Unit", selection: $servingUnit) {
                            Text("g").tag("g")
                            Text("ml").tag("ml")
                            Text("oz").tag("oz")
                            Text("cup").tag("cup")
                            Text("tbsp").tag("tbsp")
                            Text("tsp").tag("tsp")
                            Text("piece").tag("piece")
                            Text("slice").tag("slice")
                        }
                        .tint(Color.accent)
                    }
                }

                // Live preview
                if let cal = Double(calories), cal > 0 {
                    Section("Preview") {
                        NutritionLabelView(
                            calories: cal,
                            protein: Double(protein) ?? 0,
                            carbs: Double(carbs) ?? 0,
                            fat: Double(fat) ?? 0,
                            fiber: Double(fiber) ?? 0
                        )
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                }
            }
            .navigationTitle("Create Food")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!isValid)
                        .bold()
                }
            }
        }
    }

    private func save() {
        let food = Food(
            name: name,
            brand: brand,
            barcode: barcode,
            calories: Double(calories) ?? 0,
            protein: Double(protein) ?? 0,
            carbs: Double(carbs) ?? 0,
            fat: Double(fat) ?? 0,
            fiber: Double(fiber) ?? 0,
            servingSize: Double(servingSize) ?? 100,
            servingUnit: servingUnit,
            isCustom: true
        )
        modelContext.insert(food)
        try? modelContext.save()
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        onSaved?(food)
        dismiss()
    }
}

private struct NutritionField: View {
    let label: String
    @Binding var value: String
    let unit: String
    var color: Color = .primary

    var body: some View {
        HStack {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(label)
                .font(.subheadline)
            Spacer()
            TextField("0", text: $value)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 80)
            Text(unit)
                .foregroundStyle(.secondary)
                .frame(width: 35, alignment: .leading)
        }
    }
}

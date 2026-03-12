import SwiftUI
import SwiftData

struct MealTemplatesView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \MealTemplate.createdAt, order: .reverse) private var templates: [MealTemplate]

    let date: Date
    let onApply: () -> Void

    @State private var showCreateTemplate = false

    var body: some View {
        NavigationStack {
            Group {
                if templates.isEmpty {
                    emptyState
                } else {
                    templateList
                }
            }
            .navigationTitle("Meal Templates")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showCreateTemplate = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showCreateTemplate) {
                CreateTemplateView()
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "tray.2.fill")
                .font(.system(size: 48))
                .foregroundStyle(.tertiary)
            Text("No Meal Templates")
                .font(.title3.bold())
            Text("Save your go-to meals as templates\nto log them with one tap.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button {
                showCreateTemplate = true
            } label: {
                Label("Create Template", systemImage: "plus.circle.fill")
                    .font(.headline)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(Color.accent)
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
            }
            .padding(.top, 8)
            Spacer()
        }
    }

    private var templateList: some View {
        List {
            ForEach(templates) { template in
                Button {
                    applyTemplate(template)
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Image(systemName: template.mealType.icon)
                                .foregroundStyle(Color.highlight)
                                .font(.caption)
                            Text(template.name)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text("\(Int(template.totalCalories)) cal")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(Color.highlight)
                        }

                        HStack(spacing: 8) {
                            Text("\(template.items.count) item\(template.items.count == 1 ? "" : "s")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("\u{00B7}")
                                .foregroundStyle(.tertiary)
                            Text("\(Int(template.totalProtein))g protein")
                                .font(.caption)
                                .foregroundStyle(Color.accent)
                        }

                        // Item names
                        Text(template.items.compactMap { $0.food?.name }.joined(separator: ", "))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                    .padding(.vertical, 4)
                }
                .tint(.primary)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) {
                        modelContext.delete(template)
                        try? modelContext.save()
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
    }

    private func applyTemplate(_ template: MealTemplate) {
        for item in template.items {
            guard let food = item.food else { continue }
            let entry = DiaryEntry(
                date: date,
                mealType: template.mealType,
                food: food,
                numberOfServings: item.numberOfServings
            )
            modelContext.insert(entry)
        }
        try? modelContext.save()
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        onApply()
        dismiss()
    }
}

// MARK: - Create Template

private struct CreateTemplateView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \DiaryEntry.date, order: .reverse) private var recentEntries: [DiaryEntry]

    @State private var templateName = ""
    @State private var selectedMealType: MealType = .breakfast
    @State private var selectedFoods: [SelectedItem] = []

    struct SelectedItem: Identifiable {
        let id = UUID()
        let food: Food
        var servings: Double = 1
    }

    /// Get unique recent foods from last 14 days
    private var recentFoods: [Food] {
        var seen = Set<String>()
        var foods: [Food] = []
        let cutoff = Calendar.current.date(byAdding: .day, value: -14, to: Date()) ?? Date()
        for entry in recentEntries where entry.date >= cutoff {
            if let food = entry.food, !seen.contains(food.name) {
                seen.insert(food.name)
                foods.append(food)
            }
        }
        return Array(foods.prefix(30))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Template Info") {
                    TextField("e.g. My Go-To Breakfast", text: $templateName)
                    Picker("Meal Type", selection: $selectedMealType) {
                        ForEach(MealType.allCases) { type in
                            Label(type.rawValue, systemImage: type.icon).tag(type)
                        }
                    }
                }

                Section {
                    if selectedFoods.isEmpty {
                        Text("Tap foods below to add them")
                            .foregroundStyle(.secondary)
                            .font(.subheadline)
                    } else {
                        ForEach($selectedFoods) { $item in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.food.name)
                                        .font(.subheadline.weight(.medium))
                                    Text("\(Int(item.food.calories * item.servings)) cal")
                                        .font(.caption)
                                        .foregroundStyle(Color.highlight)
                                }
                                Spacer()
                                Stepper(
                                    String(format: "%.1f", item.servings),
                                    value: $item.servings,
                                    in: 0.25...10,
                                    step: 0.25
                                )
                                .font(.caption.weight(.medium))
                            }
                        }
                        .onDelete { offsets in
                            selectedFoods.remove(atOffsets: offsets)
                        }
                    }
                } header: {
                    HStack {
                        Text("Foods in Template")
                        Spacer()
                        if !selectedFoods.isEmpty {
                            let total = selectedFoods.reduce(0.0) { $0 + ($1.food.calories * $1.servings) }
                            Text("\(Int(total)) cal total")
                                .font(.caption)
                                .foregroundStyle(Color.highlight)
                        }
                    }
                }

                if !recentFoods.isEmpty {
                    Section("Add from Recent Foods") {
                        ForEach(recentFoods) { food in
                            Button {
                                selectedFoods.append(SelectedItem(food: food))
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            } label: {
                                HStack {
                                    Text(food.name)
                                        .font(.subheadline)
                                    Spacer()
                                    Text("\(Int(food.calories)) cal")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    Image(systemName: "plus.circle")
                                        .foregroundStyle(Color.accent)
                                        .font(.caption)
                                }
                            }
                            .tint(.primary)
                        }
                    }
                }
            }
            .navigationTitle("New Template")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        saveTemplate()
                    }
                    .bold()
                    .disabled(templateName.isEmpty || selectedFoods.isEmpty)
                }
            }
        }
    }

    private func saveTemplate() {
        let template = MealTemplate(name: templateName, mealType: selectedMealType)
        modelContext.insert(template)

        for item in selectedFoods {
            let templateItem = MealTemplateItem(food: item.food, numberOfServings: item.servings)
            templateItem.template = template
            modelContext.insert(templateItem)
            template.items.append(templateItem)
        }

        try? modelContext.save()
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        dismiss()
    }
}

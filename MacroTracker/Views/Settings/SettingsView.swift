import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var allEntries: [DiaryEntry]
    @Query private var allFoods: [Food]
    @Query private var allWeights: [WeightEntry]

    @State private var showDeleteConfirm = false
    @State private var showExportSheet = false
    @State private var exportText = ""

    var body: some View {
        NavigationStack {
            Form {
                // Goals (navigate to full GoalsView)
                Section {
                    NavigationLink {
                        GoalsView()
                    } label: {
                        Label {
                            Text("Daily Goals")
                        } icon: {
                            Image(systemName: "target")
                                .foregroundStyle(Color.accent)
                        }
                    }
                }

                // Data section
                Section("Your Data") {
                    HStack {
                        Label("Diary Entries", systemImage: "book.fill")
                        Spacer()
                        Text("\(allEntries.count)")
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Label("Saved Foods", systemImage: "fork.knife")
                        Spacer()
                        Text("\(allFoods.count)")
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Label("Weight Entries", systemImage: "scalemass.fill")
                        Spacer()
                        Text("\(allWeights.count)")
                            .foregroundStyle(.secondary)
                    }
                }

                // Export
                Section("Export") {
                    Button {
                        generateExport()
                        showExportSheet = true
                    } label: {
                        Label("Export Diary (CSV)", systemImage: "square.and.arrow.up")
                    }
                }

                // About
                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Text("Made with")
                        Spacer()
                        Text("SwiftUI + SwiftData")
                            .foregroundStyle(.secondary)
                    }
                }

                // Danger zone
                Section {
                    Button(role: .destructive) {
                        showDeleteConfirm = true
                    } label: {
                        Label("Reset All Data", systemImage: "trash")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Settings")
            .alert("Reset All Data?", isPresented: $showDeleteConfirm) {
                Button("Reset", role: .destructive) {
                    resetAllData()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will permanently delete all diary entries, saved foods, recipes, and weight data. This cannot be undone.")
            }
            .sheet(isPresented: $showExportSheet) {
                ShareSheet(text: exportText)
            }
        }
    }

    private func generateExport() {
        var csv = "Date,Meal,Food,Servings,Calories,Protein(g),Carbs(g),Fat(g)\n"
        let sorted = allEntries.sorted { $0.date < $1.date }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"

        for entry in sorted {
            let date = formatter.string(from: entry.date)
            let meal = entry.mealType.rawValue
            let name = entry.name.replacingOccurrences(of: ",", with: " ")
            let servings = String(format: "%.2f", entry.numberOfServings)
            let cal = String(format: "%.0f", entry.calories)
            let pro = String(format: "%.1f", entry.protein)
            let carb = String(format: "%.1f", entry.carbs)
            let fat = String(format: "%.1f", entry.fat)
            csv += "\(date),\(meal),\(name),\(servings),\(cal),\(pro),\(carb),\(fat)\n"
        }
        exportText = csv
    }

    private func resetAllData() {
        for entry in allEntries { modelContext.delete(entry) }
        for food in allFoods { modelContext.delete(food) }
        for weight in allWeights { modelContext.delete(weight) }
        try? modelContext.save()
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
}

// MARK: - Share Sheet

private struct ShareSheet: UIViewControllerRepresentable {
    let text: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let data = Data(text.utf8)
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("MacroTracker_Export.csv")
        try? data.write(to: tempURL)
        return UIActivityViewController(activityItems: [tempURL], applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

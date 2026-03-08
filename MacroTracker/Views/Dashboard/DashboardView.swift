import SwiftUI
import SwiftData
import MessageUI

struct DashboardView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var goals: [DailyGoal]
    @Query(sort: \DiaryEntry.date) private var allEntries: [DiaryEntry]

    @State private var selectedDate = Date()
    @State private var addingMealType: MealType?
    @State private var showMessageCompose = false
    @State private var showMessageUnavailable = false

    private var goal: DailyGoal {
        goals.first ?? DailyGoal()
    }

    private var dayStart: Date {
        Calendar.current.startOfDay(for: selectedDate)
    }

    private var todayEntries: [DiaryEntry] {
        allEntries.filter { Calendar.current.isDate($0.date, inSameDayAs: selectedDate) }
    }

    private func entries(for mealType: MealType) -> [DiaryEntry] {
        todayEntries.filter { $0.mealType == mealType }
    }

    private var totalCalories: Double { todayEntries.reduce(0) { $0 + $1.calories } }
    private var totalProtein: Double { todayEntries.reduce(0) { $0 + $1.protein } }
    private var totalCarbs: Double { todayEntries.reduce(0) { $0 + $1.carbs } }
    private var totalFat: Double { todayEntries.reduce(0) { $0 + $1.fat } }

    var body: some View {
        NavigationStack {
            List {
                // Date picker
                Section {
                    DatePicker("Date", selection: $selectedDate, displayedComponents: .date)
                        .datePickerStyle(.compact)
                        .tint(Color.royalBlue)

                    HStack {
                        Button {
                            selectedDate = Calendar.current.date(byAdding: .day, value: -1, to: selectedDate) ?? selectedDate
                        } label: {
                            Image(systemName: "chevron.left")
                                .font(.body.weight(.semibold))
                        }

                        Spacer()

                        if Calendar.current.isDateInToday(selectedDate) {
                            Text("Today")
                                .font(.headline)
                        } else {
                            Button("Go to Today") {
                                selectedDate = Date()
                            }
                            .font(.subheadline.weight(.medium))
                        }

                        Spacer()

                        Button {
                            selectedDate = Calendar.current.date(byAdding: .day, value: 1, to: selectedDate) ?? selectedDate
                        } label: {
                            Image(systemName: "chevron.right")
                                .font(.body.weight(.semibold))
                        }
                    }
                    .buttonStyle(.plain)
                    .tint(Color.royalBlue)
                }

                // Macro rings
                Section {
                    MacroRingsView(
                        calories: totalCalories,
                        calorieGoal: goal.calories,
                        protein: totalProtein,
                        proteinGoal: goal.protein,
                        carbs: totalCarbs,
                        carbsGoal: goal.carbs,
                        fat: totalFat,
                        fatGoal: goal.fat
                    )
                    .frame(maxWidth: .infinity)
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)

                // Macro progress bars
                Section("Macros") {
                    MacroProgressBar(label: "Calories", current: totalCalories, goal: goal.calories, color: Color.hermesOrange, unit: "kcal")
                    MacroProgressBar(label: "Protein", current: totalProtein, goal: goal.protein, color: Color.royalBlue, unit: "g")
                    MacroProgressBar(label: "Carbs", current: totalCarbs, goal: goal.carbs, color: Color.hermesOrange, unit: "g")
                    MacroProgressBar(label: "Fat", current: totalFat, goal: goal.fat, color: .pink, unit: "g")
                }

                // Meal sections
                ForEach(MealType.allCases) { mealType in
                    MealSectionView(
                        mealType: mealType,
                        entries: entries(for: mealType),
                        onAdd: {
                            addingMealType = mealType
                        },
                        onDelete: { entry in
                            modelContext.delete(entry)
                        }
                    )
                }
            }
            .navigationTitle("MacroTracker")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        if DailySummaryMessageView.canSendText {
                            showMessageCompose = true
                        } else {
                            showMessageUnavailable = true
                        }
                    } label: {
                        Image(systemName: "message.fill")
                    }
                }
            }
            .sheet(item: $addingMealType) { mealType in
                FoodSearchView(mealType: mealType, date: selectedDate)
            }
            .sheet(isPresented: $showMessageCompose) {
                DailySummaryMessageView(messageBody: formatDailySummary())
                    .ignoresSafeArea()
            }
            .alert("Messaging Unavailable", isPresented: $showMessageUnavailable) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("iMessage is not available on this device.")
            }
        }
    }

    private func formatDailySummary() -> String {
        let dateFormatter = DateFormatter()
        dateFormatter.dateStyle = .medium

        var lines: [String] = []
        lines.append("MacroTracker - \(dateFormatter.string(from: selectedDate))")
        lines.append("")
        lines.append("Calories: \(Int(totalCalories)) / \(Int(goal.calories)) kcal")
        lines.append("Protein: \(Int(totalProtein)) / \(Int(goal.protein))g")
        lines.append("Carbs: \(Int(totalCarbs)) / \(Int(goal.carbs))g")
        lines.append("Fat: \(Int(totalFat)) / \(Int(goal.fat))g")

        for mealType in MealType.allCases {
            let mealEntries = entries(for: mealType)
            guard !mealEntries.isEmpty else { continue }

            let mealCal = mealEntries.reduce(0) { $0 + $1.calories }
            lines.append("")
            lines.append("\(mealType.rawValue) (\(Int(mealCal)) cal)")
            for entry in mealEntries {
                let servingsStr = String(format: "%.1f", entry.numberOfServings)
                lines.append("- \(entry.name) x\(servingsStr)")
            }
        }

        return lines.joined(separator: "\n")
    }
}

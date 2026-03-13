import SwiftUI

struct StreakBannerView: View {
    let streak: Int
    let todayCalories: Double
    let calorieGoal: Double
    let todayProtein: Double
    let proteinGoal: Double

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 0..<12: return "Good morning"
        case 12..<17: return "Good afternoon"
        default: return "Good evening"
        }
    }

    private var motivationalMessage: String {
        let calorieProgress = calorieGoal > 0 ? todayCalories / calorieGoal : 0
        let proteinProgress = proteinGoal > 0 ? todayProtein / proteinGoal : 0

        if todayCalories == 0 {
            return streak > 1
                ? "You're on a \(streak)-day streak! Start logging to keep it going."
                : "Start logging your meals to build a streak!"
        } else if calorieProgress >= 0.9 && calorieProgress <= 1.1 && proteinProgress >= 0.8 {
            return "You're crushing it today! Great macro balance."
        } else if calorieProgress > 1.1 {
            return "You're over your calorie goal. Stay mindful!"
        } else if proteinProgress < 0.5 && calorieProgress > 0.5 {
            return "Don't forget to hit your protein target!"
        } else if calorieProgress >= 0.5 {
            return "Solid progress! Keep going."
        } else {
            return "Let's make today count!"
        }
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(greeting)
                        .font(.title3.bold())

                    Text(motivationalMessage)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()

                if streak > 0 {
                    VStack(spacing: 2) {
                        Image(systemName: "flame.fill")
                            .font(.title2)
                            .foregroundStyle(streakColor)

                        Text("\(streak)")
                            .font(.system(size: 20, weight: .bold, design: .rounded))

                        Text(streak == 1 ? "day" : "days")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(streakColor.opacity(0.12))
                    )
                }
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.cardBackground)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(
                            LinearGradient(
                                colors: [streakColor.opacity(0.06), Color.clear],
                                startPoint: .topTrailing,
                                endPoint: .bottomLeading
                            )
                        )
                )
        )
    }

    private var streakColor: Color {
        if streak >= 30 { return .red }
        if streak >= 14 { return .orange }
        if streak >= 7 { return Color.highlight }
        return Color.accent
    }
}

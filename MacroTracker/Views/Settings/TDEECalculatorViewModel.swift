import Foundation
import Observation

@Observable
final class TDEECalculatorViewModel {

    // MARK: - Step Navigation

    enum CalculatorStep: Int, CaseIterable {
        case profile = 0
        case activity = 1
        case goal = 2
        case results = 3

        var title: String {
            switch self {
            case .profile: "Your Profile"
            case .activity: "Activity Level"
            case .goal: "Your Goal"
            case .results: "Your Macros"
            }
        }

        var next: CalculatorStep {
            CalculatorStep(rawValue: rawValue + 1) ?? self
        }

        var previous: CalculatorStep {
            CalculatorStep(rawValue: rawValue - 1) ?? self
        }
    }

    // MARK: - Biological Sex

    enum BiologicalSex: String, CaseIterable, Identifiable {
        case male = "Male"
        case female = "Female"
        var id: String { rawValue }
    }

    // MARK: - Activity Level

    enum ActivityLevel: String, CaseIterable, Identifiable {
        case sedentary = "Sedentary"
        case lightlyActive = "Lightly Active"
        case moderatelyActive = "Moderately Active"
        case veryActive = "Very Active"
        case extraActive = "Extra Active"

        var id: String { rawValue }

        var multiplier: Double {
            switch self {
            case .sedentary: 1.2
            case .lightlyActive: 1.375
            case .moderatelyActive: 1.55
            case .veryActive: 1.725
            case .extraActive: 1.9
            }
        }

        var subtitle: String {
            switch self {
            case .sedentary: "Little or no exercise"
            case .lightlyActive: "Light exercise 1–3 days/week"
            case .moderatelyActive: "Moderate exercise 3–5 days/week"
            case .veryActive: "Hard exercise 6–7 days/week"
            case .extraActive: "Very hard exercise or physical job"
            }
        }

        var icon: String {
            switch self {
            case .sedentary: "figure.stand"
            case .lightlyActive: "figure.walk"
            case .moderatelyActive: "figure.run"
            case .veryActive: "figure.highintensity.intervaltraining"
            case .extraActive: "flame.fill"
            }
        }
    }

    // MARK: - Goal Type

    enum GoalType: String, CaseIterable, Identifiable {
        case lose = "Lose Weight"
        case maintain = "Maintain"
        case gain = "Gain Muscle"

        var id: String { rawValue }

        var icon: String {
            switch self {
            case .lose: "arrow.down.circle"
            case .maintain: "equal.circle"
            case .gain: "arrow.up.circle"
            }
        }

        var defaultAdjustment: Int {
            switch self {
            case .lose: -500
            case .maintain: 0
            case .gain: 500
            }
        }

        var rationale: String {
            switch self {
            case .lose:
                "Higher protein (1g/lb) preserves muscle during a deficit. Moderate fat supports hormonal health. Remaining calories from carbs for energy."
            case .maintain:
                "Balanced 30/40/30 split (protein/carbs/fat by calories) supports general health, recovery, and sustained energy."
            case .gain:
                "Adequate protein (0.8g/lb) for muscle synthesis. Higher carbs fuel intense training. Moderate fat for overall health."
            }
        }
    }

    // MARK: - Macro Result

    struct MacroResult {
        let calories: Double
        let protein: Double
        let carbs: Double
        let fat: Double

        var proteinCalories: Double { protein * 4.0 }
        var carbsCalories: Double { carbs * 4.0 }
        var fatCalories: Double { fat * 9.0 }
        var totalMacroCalories: Double { proteinCalories + carbsCalories + fatCalories }

        var proteinPercent: Double {
            guard totalMacroCalories > 0 else { return 0 }
            return proteinCalories / totalMacroCalories * 100
        }

        var carbsPercent: Double {
            guard totalMacroCalories > 0 else { return 0 }
            return carbsCalories / totalMacroCalories * 100
        }

        var fatPercent: Double {
            guard totalMacroCalories > 0 else { return 0 }
            return fatCalories / totalMacroCalories * 100
        }
    }

    // MARK: - Profile Inputs

    var ageText: String = "" {
        didSet { UserDefaults.standard.set(ageText, forKey: "tdee_ageText") }
    }

    var sex: BiologicalSex = .male {
        didSet { UserDefaults.standard.set(sex.rawValue, forKey: "tdee_sex") }
    }

    var useMetric: Bool = false {
        didSet { UserDefaults.standard.set(useMetric, forKey: "tdee_useMetric") }
    }

    var weightText: String = "" {
        didSet { UserDefaults.standard.set(weightText, forKey: "tdee_weightText") }
    }

    var heightFeetText: String = "" {
        didSet { UserDefaults.standard.set(heightFeetText, forKey: "tdee_heightFeetText") }
    }

    var heightInchesText: String = "" {
        didSet { UserDefaults.standard.set(heightInchesText, forKey: "tdee_heightInchesText") }
    }

    var heightCmText: String = "" {
        didSet { UserDefaults.standard.set(heightCmText, forKey: "tdee_heightCmText") }
    }

    // MARK: - Activity & Goal

    var activityLevel: ActivityLevel = .moderatelyActive {
        didSet { UserDefaults.standard.set(activityLevel.rawValue, forKey: "tdee_activity") }
    }

    var goalType: GoalType = .maintain {
        didSet { calorieAdjustment = goalType.defaultAdjustment }
    }

    var calorieAdjustment: Int = 0

    // MARK: - Body Composition (optional)

    var useBodyFat: Bool = false
    var bodyFatPercentage: Double = 20.0

    // MARK: - Parsed Values

    var age: Int {
        Int(ageText) ?? 0
    }

    var weightValue: Double {
        Double(weightText) ?? 0
    }

    var heightFeet: Int {
        Int(heightFeetText) ?? 0
    }

    var heightInches: Int {
        Int(heightInchesText) ?? 0
    }

    var heightCm: Double {
        Double(heightCmText) ?? 0
    }

    // MARK: - Unit Conversions

    var weightInKg: Double {
        useMetric ? weightValue : weightValue * 0.453592
    }

    var weightInLbs: Double {
        useMetric ? weightValue / 0.453592 : weightValue
    }

    var heightInCm: Double {
        useMetric ? heightCm : Double(heightFeet * 12 + heightInches) * 2.54
    }

    // MARK: - Calculations

    /// Basal Metabolic Rate (Mifflin-St Jeor)
    var bmr: Double {
        let base = 10.0 * weightInKg + 6.25 * heightInCm - 5.0 * Double(age)
        switch sex {
        case .male: return base + 5.0
        case .female: return base - 161.0
        }
    }

    /// Total Daily Energy Expenditure
    var tdee: Double {
        bmr * activityLevel.multiplier
    }

    /// Target calories after goal adjustment
    var targetCalories: Double {
        max(tdee + Double(calorieAdjustment), 0)
    }

    /// Lean body mass in lbs (uses body fat % if enabled)
    var leanBodyMassLbs: Double {
        let lbs = weightInLbs
        if useBodyFat {
            return lbs * (1.0 - bodyFatPercentage / 100.0)
        }
        return lbs
    }

    // MARK: - Smart Macro Split

    var suggestedMacros: MacroResult {
        let cal = targetCalories
        let lbs = weightInLbs

        let proteinGrams: Double
        let fatGrams: Double
        let carbGrams: Double

        switch goalType {
        case .lose:
            proteinGrams = useBodyFat ? leanBodyMassLbs * 1.1 : lbs * 1.0
            fatGrams = lbs * 0.35
            let remainder = cal - (proteinGrams * 4.0) - (fatGrams * 9.0)
            carbGrams = max(remainder / 4.0, 0)

        case .maintain:
            proteinGrams = (cal * 0.30) / 4.0
            carbGrams = (cal * 0.40) / 4.0
            fatGrams = (cal * 0.30) / 9.0

        case .gain:
            proteinGrams = useBodyFat ? leanBodyMassLbs * 1.0 : lbs * 0.8
            fatGrams = lbs * 0.3
            let remainder = cal - (proteinGrams * 4.0) - (fatGrams * 9.0)
            carbGrams = max(remainder / 4.0, 0)
        }

        return MacroResult(
            calories: cal,
            protein: proteinGrams,
            carbs: carbGrams,
            fat: fatGrams
        )
    }

    // MARK: - Warnings

    var carbsWarning: Bool {
        let macros = suggestedMacros
        return macros.carbs <= 0
    }

    var lowCalorieWarning: Bool {
        targetCalories < 1200
    }

    // MARK: - Validation

    var isProfileValid: Bool {
        age > 0 && age < 120
        && weightValue > 0
        && (useMetric ? heightCm > 0 : (heightFeet > 0 || heightInches > 0))
    }

    // MARK: - Calorie Adjustment Options

    static let adjustmentOptions: [Int] = [-500, -250, 0, 250, 500]

    // MARK: - Init

    init() {
        let defaults = UserDefaults.standard
        self.ageText = defaults.string(forKey: "tdee_ageText") ?? ""
        let sexRaw = defaults.string(forKey: "tdee_sex") ?? BiologicalSex.male.rawValue
        self.sex = BiologicalSex(rawValue: sexRaw) ?? .male
        self.useMetric = defaults.bool(forKey: "tdee_useMetric")
        self.weightText = defaults.string(forKey: "tdee_weightText") ?? ""
        self.heightFeetText = defaults.string(forKey: "tdee_heightFeetText") ?? ""
        self.heightInchesText = defaults.string(forKey: "tdee_heightInchesText") ?? ""
        self.heightCmText = defaults.string(forKey: "tdee_heightCmText") ?? ""
        let activityRaw = defaults.string(forKey: "tdee_activity") ?? ActivityLevel.moderatelyActive.rawValue
        self.activityLevel = ActivityLevel(rawValue: activityRaw) ?? .moderatelyActive
    }
}

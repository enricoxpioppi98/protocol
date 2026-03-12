import Foundation
import SwiftData

@Model
final class WeightEntry {
    var id: UUID
    var date: Date
    var weight: Double  // stored in lbs
    var note: String

    init(date: Date = .now, weight: Double, note: String = "") {
        self.id = UUID()
        self.date = Calendar.current.startOfDay(for: date)
        self.weight = weight
        self.note = note
    }
}

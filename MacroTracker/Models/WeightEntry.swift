import Foundation
import SwiftData

@Model
final class WeightEntry {
    var id: UUID
    var date: Date
    var weight: Double  // stored in lbs
    var note: String
    var updatedAt: Date
    var deletedAt: Date?

    init(date: Date = .now, weight: Double, note: String = "") {
        self.id = UUID()
        self.date = Calendar.current.startOfDay(for: date)
        self.weight = weight
        self.note = note
        self.updatedAt = Date()
        self.deletedAt = nil
    }
}

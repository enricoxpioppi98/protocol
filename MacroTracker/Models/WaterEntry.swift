import Foundation
import SwiftData

@Model
final class WaterEntry {
    var id: UUID
    var date: Date
    var glasses: Int

    init(date: Date = .now, glasses: Int = 0) {
        self.id = UUID()
        self.date = Calendar.current.startOfDay(for: date)
        self.glasses = glasses
    }
}

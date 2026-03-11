import SwiftUI
import SwiftData

struct QuickAddView: View {
    let recentEntries: [DiaryEntry]
    let date: Date
    let onQuickAdd: (DiaryEntry) -> Void

    /// Deduplicated recent foods/recipes by name, most recent first
    private var quickItems: [DiaryEntry] {
        var seen = Set<String>()
        var result: [DiaryEntry] = []
        for entry in recentEntries.reversed() {
            let key = entry.name
            if !seen.contains(key) {
                seen.insert(key)
                result.append(entry)
            }
            if result.count >= 8 { break }
        }
        return result
    }

    var body: some View {
        if !quickItems.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(quickItems) { entry in
                        Button {
                            onQuickAdd(entry)
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        } label: {
                            VStack(spacing: 6) {
                                Image(systemName: entry.mealType.icon)
                                    .font(.body)
                                    .foregroundStyle(Color.highlight)
                                    .frame(width: 32, height: 32)
                                    .background(Color.highlight.opacity(0.12))
                                    .clipShape(Circle())

                                Text(entry.name)
                                    .font(.caption2.weight(.medium))
                                    .lineLimit(2)
                                    .multilineTextAlignment(.center)

                                Text("\(Int(entry.calories / entry.numberOfServings)) cal")
                                    .font(.system(size: 9, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            .frame(width: 72)
                            .padding(.vertical, 10)
                            .padding(.horizontal, 4)
                            .background(Color.cardBackground)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.subtleBorder, lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
        }
    }
}

import SwiftUI

struct MealSectionView: View {
    let mealType: MealType
    let entries: [DiaryEntry]
    let onAdd: () -> Void
    let onDelete: (DiaryEntry) -> Void
    let onEdit: (DiaryEntry) -> Void

    private var totalCalories: Double {
        entries.reduce(0) { $0 + $1.calories }
    }

    var body: some View {
        Section {
            ForEach(entries) { entry in
                Button {
                    onEdit(entry)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.name)
                                .font(.subheadline.weight(.medium))
                            Text(String(format: "%.1f serving%@", entry.numberOfServings, entry.numberOfServings == 1 ? "" : "s"))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 3) {
                            Text("\(Int(entry.calories)) cal")
                                .font(.subheadline.bold())
                                .foregroundStyle(Color.highlight)
                            HStack(spacing: 8) {
                                MacroPill(value: entry.protein, label: "P", color: Color.accent)
                                MacroPill(value: entry.carbs, label: "C", color: Color.highlight)
                                MacroPill(value: entry.fat, label: "F", color: .pink)
                            }
                        }
                    }
                }
                .tint(.primary)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        onDelete(entry)
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }

            Button {
                onAdd()
            } label: {
                Label("Add Food", systemImage: "plus")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.accent)
                    .padding(.vertical, 4)
                    .padding(.horizontal, 12)
                    .background(Color.accent.opacity(0.1))
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        } header: {
            HStack {
                Image(systemName: mealType.icon)
                    .foregroundStyle(Color.highlight)
                Text(mealType.rawValue)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(Int(totalCalories)) cal")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct MacroPill: View {
    let value: Double
    let label: String
    let color: Color

    var body: some View {
        Text("\(label)\(Int(value))")
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(color)
    }
}

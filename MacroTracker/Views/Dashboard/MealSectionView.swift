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

    private var totalProtein: Double {
        entries.reduce(0) { $0 + $1.protein }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(spacing: 10) {
                Image(systemName: mealType.icon)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Color.highlight.gradient)
                    .clipShape(Circle())

                Text(mealType.rawValue)
                    .font(.subheadline.weight(.semibold))

                Spacer()

                if totalCalories > 0 {
                    Text("\(Int(totalCalories)) cal")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    Text("\u{00B7}")
                        .foregroundStyle(.tertiary)
                    Text("\(Int(totalProtein))g P")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color.accent)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider().padding(.horizontal, 16)

            // Entries
            if entries.isEmpty {
                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    onAdd()
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "plus.circle")
                            .foregroundStyle(Color.accent)
                        Text("Add \(mealType.rawValue.lowercased())")
                            .font(.subheadline)
                            .foregroundStyle(Color.accent)
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                }
                .buttonStyle(ScaleButtonStyle())
            } else {
                VStack(spacing: 0) {
                    ForEach(entries) { entry in
                        SwipeToDeleteWrapper(onDelete: { onDelete(entry) }) {
                            Button {
                                onEdit(entry)
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(entry.name)
                                            .font(.subheadline.weight(.medium))
                                            .foregroundStyle(.primary)
                                        Text(String(format: "%.1f serving%@", entry.numberOfServings, entry.numberOfServings == 1 ? "" : "s"))
                                            .font(.caption2)
                                            .foregroundStyle(.tertiary)
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 3) {
                                        Text("\(Int(entry.calories)) cal")
                                            .font(.subheadline.bold())
                                            .foregroundStyle(Color.highlight)
                                        HStack(spacing: 8) {
                                            MacroPill(value: entry.protein, label: "P", color: Color.accent)
                                            MacroPill(value: entry.carbs, label: "C", color: Color.highlight)
                                            MacroPill(value: entry.fat, label: "F", color: Color.fatColor)
                                        }
                                    }
                                }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .contentShape(Rectangle())
                                .background(Color.cardBackground)
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button(role: .destructive) {
                                    onDelete(entry)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }

                        if entry.id != entries.last?.id {
                            Divider().padding(.leading, 16)
                        }
                    }

                    Divider().padding(.horizontal, 16)

                    // Add button
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        onAdd()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "plus")
                                .font(.caption.weight(.semibold))
                            Text("Add Food")
                                .font(.caption.weight(.semibold))
                        }
                        .foregroundStyle(Color.accent)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 14)
                        .background(Color.accent.opacity(0.08))
                        .clipShape(Capsule())
                    }
                    .buttonStyle(ScaleButtonStyle())
                    .padding(.vertical, 10)
                }
            }
        }
        .background(Color.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
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

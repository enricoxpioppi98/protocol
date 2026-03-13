import SwiftUI

struct WaterTrackingView: View {
    let glasses: Int
    let goal: Int
    let onTap: () -> Void
    let onLongPress: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                Image(systemName: "drop.fill")
                    .font(.caption)
                    .foregroundStyle(Color.waterColor)
                Text("Water")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(glasses) / \(goal) glasses")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 6) {
                ForEach(0..<goal, id: \.self) { index in
                    Circle()
                        .fill(index < glasses ? Color.waterColor : Color.waterColor.opacity(0.15))
                        .frame(width: 28, height: 28)
                        .overlay {
                            if index < glasses {
                                Image(systemName: "drop.fill")
                                    .font(.system(size: 11))
                                    .foregroundStyle(.white)
                            }
                        }
                        .scaleEffect(index < glasses ? 1.0 : 0.85)
                        .animation(.spring(response: 0.3, dampingFraction: 0.6), value: glasses)
                }
                Spacer()
            }
        }
        .padding()
        .background(Color.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .onTapGesture {
            onTap()
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
        .onLongPressGesture {
            onLongPress()
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}

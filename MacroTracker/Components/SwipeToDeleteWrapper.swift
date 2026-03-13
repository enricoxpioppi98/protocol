import SwiftUI

struct SwipeToDeleteWrapper<Content: View>: View {
    let onDelete: () -> Void
    @ViewBuilder let content: () -> Content

    @State private var offset: CGFloat = 0
    @State private var isRevealed = false

    private let deleteButtonWidth: CGFloat = 80
    private let fullSwipeThreshold: CGFloat = 160

    var body: some View {
        ZStack(alignment: .trailing) {
            // Delete button behind
            HStack(spacing: 0) {
                Spacer()
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                        offset = -UIScreen.main.bounds.width
                    }
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        onDelete()
                    }
                } label: {
                    Image(systemName: "trash.fill")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: deleteButtonWidth, height: .infinity)
                        .frame(maxHeight: .infinity)
                }
                .frame(width: deleteButtonWidth)
                .background(Color.red)
            }
            .clipShape(RoundedRectangle(cornerRadius: 0))

            // Main content
            content()
                .offset(x: offset)
                .gesture(
                    DragGesture(minimumDistance: 20)
                        .onChanged { value in
                            let translation = value.translation.width
                            if translation < 0 {
                                // Swiping left — reveal delete
                                offset = translation
                            } else if isRevealed {
                                // Swiping right from revealed state
                                offset = -deleteButtonWidth + translation
                            }
                        }
                        .onEnded { value in
                            let translation = value.translation.width
                            let velocity = value.predictedEndTranslation.width

                            if -translation > fullSwipeThreshold || -velocity > 300 {
                                // Full swipe — delete immediately
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                                    offset = -UIScreen.main.bounds.width
                                }
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                                    onDelete()
                                }
                            } else if -translation > deleteButtonWidth / 2 || -velocity > 100 {
                                // Partial swipe — reveal delete button
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                                    offset = -deleteButtonWidth
                                    isRevealed = true
                                }
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            } else {
                                // Not enough — snap back
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                                    offset = 0
                                    isRevealed = false
                                }
                            }
                        }
                )
                .onTapGesture {
                    if isRevealed {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                            offset = 0
                            isRevealed = false
                        }
                    }
                }
        }
        .clipped()
    }
}

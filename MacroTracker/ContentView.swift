import SwiftUI

enum AppTab: String, CaseIterable {
    case diary = "Diary"
    case recipes = "Recipes"
    case progress = "Progress"
    case settings = "Settings"

    var icon: String {
        switch self {
        case .diary: return "book"
        case .recipes: return "frying.pan"
        case .progress: return "chart.line.uptrend.xyaxis"
        case .settings: return "gearshape"
        }
    }

    var filledIcon: String {
        switch self {
        case .diary: return "book.fill"
        case .recipes: return "frying.pan.fill"
        case .progress: return "chart.line.uptrend.xyaxis"
        case .settings: return "gearshape.fill"
        }
    }

    var index: Int {
        Self.allCases.firstIndex(of: self)!
    }

    var previous: AppTab? {
        let i = index
        return i > 0 ? Self.allCases[i - 1] : nil
    }

    var next: AppTab? {
        let i = index
        return i < Self.allCases.count - 1 ? Self.allCases[i + 1] : nil
    }
}

struct ContentView: View {
    @State private var selectedTab: AppTab = .diary

    var body: some View {
        ZStack(alignment: .bottom) {
            // All views always alive — opacity toggled
            ZStack {
                DashboardView()
                    .opacity(selectedTab == .diary ? 1 : 0)
                    .allowsHitTesting(selectedTab == .diary)
                RecipeListView()
                    .opacity(selectedTab == .recipes ? 1 : 0)
                    .allowsHitTesting(selectedTab == .recipes)
                ProgressTabView()
                    .opacity(selectedTab == .progress ? 1 : 0)
                    .allowsHitTesting(selectedTab == .progress)
                SettingsView()
                    .opacity(selectedTab == .settings ? 1 : 0)
                    .allowsHitTesting(selectedTab == .settings)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(.easeInOut(duration: 0.2), value: selectedTab)
            .gesture(
                DragGesture(minimumDistance: 30)
                    .onEnded { value in
                        guard abs(value.translation.width)
                            > abs(value.translation.height) * 0.8
                        else { return }

                        let threshold: CGFloat = 60
                        let velocity =
                            value.predictedEndTranslation.width - value.translation.width

                        if (value.translation.width + velocity * 0.3) > threshold,
                            let prev = selectedTab.previous
                        {
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.86)) {
                                selectedTab = prev
                            }
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        } else if (value.translation.width + velocity * 0.3) < -threshold,
                            let next = selectedTab.next
                        {
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.86)) {
                                selectedTab = next
                            }
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        }
                    }
            )

            // Floating tab bar
            HStack(spacing: 0) {
                ForEach(AppTab.allCases, id: \.self) { tab in
                    Button {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.86)) {
                            selectedTab = tab
                        }
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        VStack(spacing: 4) {
                            Image(
                                systemName: selectedTab == tab ? tab.filledIcon : tab.icon
                            )
                            .font(
                                .system(
                                    size: 18,
                                    weight: selectedTab == tab ? .semibold : .regular)
                            )
                            .symbolEffect(.bounce, value: selectedTab == tab)

                            Text(tab.rawValue)
                                .font(
                                    .system(
                                        size: 10,
                                        weight: selectedTab == tab ? .semibold : .regular)
                                )
                        }
                        .foregroundStyle(selectedTab == tab ? Color.accent : .secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
            .padding(.bottom, 4)
            .background(
                RoundedRectangle(cornerRadius: 24)
                    .fill(.ultraThinMaterial)
                    .shadow(color: .black.opacity(0.08), radius: 12, y: -4)
            )
            .padding(.horizontal, 16)
            .padding(.bottom, 2)
        }
        .ignoresSafeArea(.keyboard)
    }
}

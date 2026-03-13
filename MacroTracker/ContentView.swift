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
}

struct ContentView: View {
    @State private var selectedTab: AppTab = .diary

    var body: some View {
        ZStack(alignment: .bottom) {
            // Content
            Group {
                switch selectedTab {
                case .diary: DashboardView()
                case .recipes: RecipeListView()
                case .progress: ProgressTabView()
                case .settings: SettingsView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            // Floating tab bar
            HStack(spacing: 0) {
                ForEach(AppTab.allCases, id: \.self) { tab in
                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                            selectedTab = tab
                        }
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: selectedTab == tab ? tab.filledIcon : tab.icon)
                                .font(.system(size: 18, weight: selectedTab == tab ? .semibold : .regular))
                                .symbolEffect(.bounce, value: selectedTab == tab)

                            Text(tab.rawValue)
                                .font(.system(size: 10, weight: selectedTab == tab ? .semibold : .regular))
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

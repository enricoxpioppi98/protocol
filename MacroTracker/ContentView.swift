import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem {
                    Label("Diary", systemImage: "book.fill")
                }

            RecipeListView()
                .tabItem {
                    Label("Recipes", systemImage: "frying.pan.fill")
                }

            GoalsView()
                .tabItem {
                    Label("Goals", systemImage: "target")
                }
        }
        .tint(Color.accent)
    }
}

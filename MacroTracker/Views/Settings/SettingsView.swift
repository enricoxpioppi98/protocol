import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var allEntries: [DiaryEntry]
    @Query private var allFoods: [Food]
    @Query private var allWeights: [WeightEntry]

    @State private var showDeleteConfirm = false
    @State private var showExportSheet = false
    @State private var exportText = ""
    @State private var showSignIn = false
    @State private var syncError: String?

    // API keys
    @AppStorage("nutritionix_app_id") private var nutritionixAppId = ""
    @AppStorage("nutritionix_app_key") private var nutritionixAppKey = ""
    @AppStorage("usda_api_key") private var usdaApiKey = ""
    @State private var showAPISection = false

    var body: some View {
        NavigationStack {
            Form {
                // Cloud Sync
                cloudSyncSection

                // Goals (navigate to full GoalsView)
                Section {
                    NavigationLink {
                        GoalsView()
                    } label: {
                        Label {
                            Text("Daily Goals")
                        } icon: {
                            Image(systemName: "target")
                                .foregroundStyle(Color.accent)
                        }
                    }
                }

                // Data section
                Section("Your Data") {
                    HStack {
                        Label("Diary Entries", systemImage: "book.fill")
                        Spacer()
                        Text("\(allEntries.count)")
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Label("Saved Foods", systemImage: "fork.knife")
                        Spacer()
                        Text("\(allFoods.count)")
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Label("Weight Entries", systemImage: "scalemass.fill")
                        Spacer()
                        Text("\(allWeights.count)")
                            .foregroundStyle(.secondary)
                    }
                }

                // Export
                Section("Export") {
                    Button {
                        generateExport()
                        showExportSheet = true
                    } label: {
                        Label("Export Diary (CSV)", systemImage: "square.and.arrow.up")
                    }
                }

                // API Keys
                Section {
                    DisclosureGroup("API Keys", isExpanded: $showAPISection) {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Add API keys to unlock restaurant & chain food search (Nutritionix) and increase USDA rate limits.")
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            // Nutritionix
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text("Nutritionix")
                                        .font(.subheadline.weight(.semibold))
                                    Spacer()
                                    if !nutritionixAppId.isEmpty && !nutritionixAppKey.isEmpty {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(.green)
                                            .font(.caption)
                                    }
                                }
                                TextField("App ID", text: $nutritionixAppId)
                                    .font(.caption)
                                    .textFieldStyle(.roundedBorder)
                                    .autocorrectionDisabled()
                                    .textInputAutocapitalization(.never)
                                TextField("App Key", text: $nutritionixAppKey)
                                    .font(.caption)
                                    .textFieldStyle(.roundedBorder)
                                    .autocorrectionDisabled()
                                    .textInputAutocapitalization(.never)
                                Text("Free at developer.nutritionix.com")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }

                            Divider()

                            // USDA
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text("USDA FoodData Central")
                                        .font(.subheadline.weight(.semibold))
                                    Spacer()
                                    if !usdaApiKey.isEmpty {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(.green)
                                            .font(.caption)
                                    }
                                }
                                TextField("API Key (optional)", text: $usdaApiKey)
                                    .font(.caption)
                                    .textFieldStyle(.roundedBorder)
                                    .autocorrectionDisabled()
                                    .textInputAutocapitalization(.never)
                                Text("Defaults to DEMO_KEY (limited). Get yours at fdc.nal.usda.gov")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                } header: {
                    Label("Food Search", systemImage: "magnifyingglass")
                }

                // About
                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Text("Made with")
                        Spacer()
                        Text("SwiftUI + SwiftData")
                            .foregroundStyle(.secondary)
                    }
                }

                // Danger zone
                Section {
                    Button(role: .destructive) {
                        showDeleteConfirm = true
                    } label: {
                        Label("Reset All Data", systemImage: "trash")
                            .foregroundStyle(.red)
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Spacer().frame(height: 70)
            }
            .navigationTitle("Settings")
            .alert("Reset All Data?", isPresented: $showDeleteConfirm) {
                Button("Reset", role: .destructive) {
                    resetAllData()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will permanently delete all diary entries, saved foods, recipes, and weight data. This cannot be undone.")
            }
            .sheet(isPresented: $showSignIn) {
                SignInSheet()
            }
            .sheet(isPresented: $showExportSheet) {
                ShareSheet(text: exportText)
            }
        }
    }

    // MARK: - Cloud Sync Section

    @ViewBuilder
    private var cloudSyncSection: some View {
        let manager = SupabaseManager.shared

        Section {
            if manager.isSignedIn {
                // Signed in state
                HStack {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(manager.userEmail ?? "Signed In")
                                .font(.subheadline)
                            if let lastSync = manager.lastSyncDate {
                                Text("Last synced \(lastSync, style: .relative) ago")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } icon: {
                        Image(systemName: "checkmark.icloud.fill")
                            .foregroundStyle(.green)
                    }
                    Spacer()
                    if manager.isSyncing {
                        ProgressView()
                    }
                }

                Button {
                    Task { await performSync() }
                } label: {
                    Label("Sync Now", systemImage: "arrow.triangle.2.circlepath")
                }
                .disabled(manager.isSyncing)

                if let syncError {
                    Text(syncError)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                Button(role: .destructive) {
                    Task {
                        try? await manager.signOut()
                    }
                } label: {
                    Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                }
            } else {
                // Signed out state
                Button {
                    showSignIn = true
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Enable Cloud Sync")
                                .font(.subheadline.weight(.medium))
                            Text("Sign in to sync across devices")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "icloud")
                            .foregroundStyle(Color.accent)
                    }
                }
            }
        } header: {
            Label("Cloud Sync", systemImage: "icloud")
        }
    }

    // MARK: - Sync

    @MainActor
    private func performSync() async {
        syncError = nil
        do {
            let syncService = SyncService(
                supabase: SupabaseManager.shared.client,
                modelContainer: modelContext.container
            )
            try await syncService.sync()
        } catch {
            syncError = error.localizedDescription
        }
    }

    // MARK: - Export & Reset

    private func generateExport() {
        var csv = "Date,Meal,Food,Servings,Calories,Protein(g),Carbs(g),Fat(g)\n"
        let sorted = allEntries.sorted { $0.date < $1.date }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"

        for entry in sorted {
            let date = formatter.string(from: entry.date)
            let meal = entry.mealType.rawValue
            let name = entry.name.replacingOccurrences(of: ",", with: " ")
            let servings = String(format: "%.2f", entry.numberOfServings)
            let cal = String(format: "%.0f", entry.calories)
            let pro = String(format: "%.1f", entry.protein)
            let carb = String(format: "%.1f", entry.carbs)
            let fat = String(format: "%.1f", entry.fat)
            csv += "\(date),\(meal),\(name),\(servings),\(cal),\(pro),\(carb),\(fat)\n"
        }
        exportText = csv
    }

    private func resetAllData() {
        for entry in allEntries { modelContext.delete(entry) }
        for food in allFoods { modelContext.delete(food) }
        for weight in allWeights { modelContext.delete(weight) }
        try? modelContext.save()
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
}

// MARK: - Sign In Sheet

private struct SignInSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var isSignUp = false
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    SecureField("Password", text: $password)
                        .textContentType(isSignUp ? .newPassword : .password)
                }

                if let error {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }

                Section {
                    Button {
                        Task { await authenticate() }
                    } label: {
                        HStack {
                            Spacer()
                            if loading {
                                ProgressView()
                            } else {
                                Text(isSignUp ? "Create Account" : "Sign In")
                                    .fontWeight(.semibold)
                            }
                            Spacer()
                        }
                    }
                    .disabled(email.isEmpty || password.isEmpty || loading)
                }

                Section {
                    Button {
                        isSignUp.toggle()
                        error = nil
                    } label: {
                        Text(isSignUp ? "Already have an account? Sign In" : "Don't have an account? Sign Up")
                            .font(.caption)
                    }
                }
            }
            .navigationTitle(isSignUp ? "Create Account" : "Sign In")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func authenticate() async {
        loading = true
        error = nil
        do {
            let manager = SupabaseManager.shared
            if isSignUp {
                try await manager.signUp(email: email, password: password)
            } else {
                try await manager.signIn(email: email, password: password)
            }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}

// MARK: - Share Sheet

private struct ShareSheet: UIViewControllerRepresentable {
    let text: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let data = Data(text.utf8)
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("MacroTracker_Export.csv")
        try? data.write(to: tempURL)
        return UIActivityViewController(activityItems: [tempURL], applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

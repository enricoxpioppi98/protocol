import Foundation
import Supabase
import Observation

@Observable
@MainActor
final class SupabaseManager {
    static let shared = SupabaseManager()

    let client: SupabaseClient

    var isSignedIn = false
    var userEmail: String?
    var isSyncing = false
    var lastSyncDate: Date? {
        get {
            let interval = UserDefaults.standard.double(forKey: "lastSyncTimestamp")
            return interval > 0 ? Date(timeIntervalSince1970: interval) : nil
        }
        set {
            UserDefaults.standard.set(newValue?.timeIntervalSince1970 ?? 0, forKey: "lastSyncTimestamp")
        }
    }

    private init() {
        client = SupabaseClient(
            supabaseURL: URL(string: "https://oecccaqhxacmnopexmsj.supabase.co")!,
            supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lY2NjYXFoeGFjbW5vcGV4bXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMzEzNTMsImV4cCI6MjA5MTcwNzM1M30.6te529I0uENmn0IIqWUVZYNUCouFi7VEeytJ0Sm3gfw"
        )
    }

    func checkSession() async {
        do {
            let session = try await client.auth.session
            isSignedIn = true
            userEmail = session.user.email
        } catch {
            isSignedIn = false
            userEmail = nil
        }
    }

    func signIn(email: String, password: String) async throws {
        let session = try await client.auth.signIn(email: email, password: password)
        isSignedIn = true
        userEmail = session.user.email
    }

    func signUp(email: String, password: String) async throws {
        let session = try await client.auth.signUp(email: email, password: password)
        isSignedIn = true
        userEmail = session.user.email
    }

    func signOut() async throws {
        try await client.auth.signOut()
        isSignedIn = false
        userEmail = nil
        lastSyncDate = nil
    }
}

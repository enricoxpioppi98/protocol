import SwiftUI
import MessageUI

struct DailySummaryMessageView: UIViewControllerRepresentable {
    let messageBody: String
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIViewController(context: Context) -> MFMessageComposeViewController {
        let controller = MFMessageComposeViewController()
        controller.body = messageBody
        controller.messageComposeDelegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: MFMessageComposeViewController, context: Context) {}

    class Coordinator: NSObject, @preconcurrency MFMessageComposeViewControllerDelegate {
        let parent: DailySummaryMessageView

        init(parent: DailySummaryMessageView) {
            self.parent = parent
        }

        @MainActor
        func messageComposeViewController(_ controller: MFMessageComposeViewController, didFinishWith result: MessageComposeResult) {
            parent.dismiss()
        }
    }

    static var canSendText: Bool {
        MFMessageComposeViewController.canSendText()
    }
}

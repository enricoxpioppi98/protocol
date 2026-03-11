import SwiftUI
import VisionKit
import AVFoundation

struct BarcodeScannerView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let onFoodFound: (Food) -> Void

    @State private var scannedCode: String?
    @State private var isLookingUp = false
    @State private var errorMessage: String?
    @State private var manualBarcode = ""
    @State private var showManualEntry = false

    private var isScannerAvailable: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    var body: some View {
        NavigationStack {
            ZStack {
                if !showManualEntry && isScannerAvailable {
                    DataScannerRepresentable(onBarcodeScanned: handleBarcode)
                        .ignoresSafeArea()

                    // Overlay
                    VStack {
                        Spacer()

                        // Scanning frame
                        RoundedRectangle(cornerRadius: 20)
                            .strokeBorder(Color.accent, lineWidth: 3)
                            .frame(width: 280, height: 140)
                            .background(.clear)
                            .shadow(color: Color.accent.opacity(0.3), radius: 8)

                        Spacer()

                        // Bottom panel
                        VStack(spacing: 14) {
                            if isLookingUp {
                                HStack(spacing: 10) {
                                    ProgressView()
                                        .tint(.white)
                                    Text("Looking up barcode...")
                                        .foregroundStyle(.white)
                                        .font(.subheadline.weight(.medium))
                                }
                            } else if let errorMessage {
                                VStack(spacing: 8) {
                                    Text(errorMessage)
                                        .foregroundStyle(.red)
                                        .font(.subheadline)
                                        .multilineTextAlignment(.center)
                                    Button("Try Again") {
                                        self.errorMessage = nil
                                        self.scannedCode = nil
                                    }
                                    .font(.subheadline.bold())
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 20)
                                    .padding(.vertical, 8)
                                    .background(Color.accent)
                                    .clipShape(Capsule())
                                }
                            } else {
                                VStack(spacing: 4) {
                                    Image(systemName: "barcode.viewfinder")
                                        .font(.title2)
                                        .foregroundStyle(.white)
                                    Text("Point camera at a barcode")
                                        .foregroundStyle(.white)
                                        .font(.subheadline.weight(.medium))
                                }
                            }

                            Button {
                                showManualEntry = true
                            } label: {
                                Label("Enter manually", systemImage: "keyboard")
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(.white.opacity(0.7))
                            }
                        }
                        .padding(.vertical, 20)
                        .padding(.horizontal)
                        .frame(maxWidth: .infinity)
                        .background(.ultraThinMaterial)
                    }
                } else {
                    // Manual barcode entry
                    Form {
                        if !isScannerAvailable && !showManualEntry {
                            Section {
                                Label {
                                    Text("Camera scanning is not available on this device.")
                                        .foregroundStyle(.secondary)
                                } icon: {
                                    Image(systemName: "camera.fill")
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }

                        Section("Enter Barcode Number") {
                            TextField("e.g. 0012345678905", text: $manualBarcode)
                                .keyboardType(.numberPad)
                                .font(.system(.body, design: .monospaced))
                        }

                        Section {
                            Button {
                                handleBarcode(manualBarcode)
                            } label: {
                                HStack {
                                    Spacer()
                                    if isLookingUp {
                                        ProgressView()
                                            .tint(.white)
                                    } else {
                                        Label("Look Up", systemImage: "magnifyingglass")
                                    }
                                    Spacer()
                                }
                                .font(.headline)
                                .foregroundStyle(.white)
                                .padding(.vertical, 4)
                            }
                            .listRowBackground(
                                (manualBarcode.isEmpty || isLookingUp) ? Color.gray : Color.accent
                            )
                            .disabled(manualBarcode.isEmpty || isLookingUp)

                            if let errorMessage {
                                Text(errorMessage)
                                    .foregroundStyle(.red)
                                    .font(.caption)
                            }
                        }

                        if isScannerAvailable {
                            Section {
                                Button {
                                    showManualEntry = false
                                } label: {
                                    Label("Use Camera Instead", systemImage: "camera.fill")
                                        .foregroundStyle(Color.accent)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Scan Barcode")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func handleBarcode(_ code: String) {
        guard !code.isEmpty, !isLookingUp else { return }
        guard scannedCode != code else { return }

        scannedCode = code
        isLookingUp = true
        errorMessage = nil

        Task {
            do {
                // Try OpenFoodFacts first
                if let product = try await OpenFoodFactsService.shared.lookupBarcode(code) {
                    await foundProduct(product)
                    return
                }

                // Fallback: search USDA by barcode string
                let usdaResults = try await USDAFoodService.shared.searchProducts(query: code)
                if let match = usdaResults.first(where: { $0.barcode == code }) ?? usdaResults.first {
                    await foundProduct(match)
                    return
                }

                // Neither API found the product
                await MainActor.run {
                    isLookingUp = false
                    UINotificationFeedbackGenerator().notificationOccurred(.error)
                    errorMessage = "Product not found for barcode: \(code)"
                    scannedCode = nil
                }
            } catch {
                await MainActor.run {
                    isLookingUp = false
                    UINotificationFeedbackGenerator().notificationOccurred(.error)
                    errorMessage = "Lookup failed. Check your connection."
                    scannedCode = nil
                }
            }
        }
    }

    private func foundProduct(_ product: FoodProduct) async {
        let food = product.toFood()
        await MainActor.run {
            modelContext.insert(food)
            try? modelContext.save()
            isLookingUp = false
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onFoodFound(food)
            dismiss()
        }
    }
}

// MARK: - DataScannerViewController wrapper

private struct DataScannerRepresentable: UIViewControllerRepresentable {
    let onBarcodeScanned: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onBarcodeScanned: onBarcodeScanned)
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [
                .barcode(symbologies: [.ean8, .ean13, .upce, .code128, .code39])
            ],
            qualityLevel: .balanced,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {}

    @MainActor
    class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onBarcodeScanned: (String) -> Void
        private var hasScanned = false

        init(onBarcodeScanned: @escaping (String) -> Void) {
            self.onBarcodeScanned = onBarcodeScanned
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !hasScanned else { return }
            for item in addedItems {
                if case .barcode(let barcode) = item, let value = barcode.payloadStringValue {
                    hasScanned = true
                    AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
                    dataScanner.stopScanning()
                    onBarcodeScanned(value)
                    return
                }
            }
        }
    }
}

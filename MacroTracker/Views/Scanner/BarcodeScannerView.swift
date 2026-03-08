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
                        RoundedRectangle(cornerRadius: 16)
                            .strokeBorder(.white, lineWidth: 2)
                            .frame(width: 280, height: 140)
                            .background(.clear)

                        Spacer()

                        // Bottom panel
                        VStack(spacing: 12) {
                            if isLookingUp {
                                ProgressView("Looking up barcode...")
                                    .tint(.white)
                                    .foregroundStyle(.white)
                            } else if let errorMessage {
                                Text(errorMessage)
                                    .foregroundStyle(.red)
                                    .font(.subheadline)
                                Button("Try Again") {
                                    self.errorMessage = nil
                                    self.scannedCode = nil
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(Color.accentColor)
                            } else {
                                Text("Point camera at a barcode")
                                    .foregroundStyle(.white)
                                    .font(.headline)
                            }

                            Button("Enter Barcode Manually") {
                                showManualEntry = true
                            }
                            .foregroundStyle(.white.opacity(0.8))
                            .font(.subheadline)
                        }
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(.ultraThinMaterial)
                    }
                } else {
                    // Manual barcode entry (also shown if scanner not available)
                    Form {
                        if !isScannerAvailable && !showManualEntry {
                            Section {
                                Text("Camera scanning is not available on this device. Enter the barcode manually.")
                                    .foregroundStyle(.secondary)
                            }
                        }

                        Section("Enter Barcode Number") {
                            TextField("e.g. 0012345678905", text: $manualBarcode)
                                .keyboardType(.numberPad)
                        }
                        Section {
                            Button("Look Up") {
                                handleBarcode(manualBarcode)
                            }
                            .disabled(manualBarcode.isEmpty || isLookingUp)

                            if isLookingUp {
                                HStack {
                                    ProgressView()
                                    Text("Searching...")
                                }
                            }

                            if let errorMessage {
                                Text(errorMessage)
                                    .foregroundStyle(.red)
                            }
                        }

                        if isScannerAvailable {
                            Section {
                                Button("Use Camera Instead") {
                                    showManualEntry = false
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
                if let product = try await OpenFoodFactsService.shared.lookupBarcode(code) {
                    let food = product.toFood()
                    await MainActor.run {
                        modelContext.insert(food)
                        isLookingUp = false
                        onFoodFound(food)
                        dismiss()
                    }
                } else {
                    await MainActor.run {
                        isLookingUp = false
                        errorMessage = "Product not found for barcode: \(code)"
                        scannedCode = nil
                    }
                }
            } catch {
                await MainActor.run {
                    isLookingUp = false
                    errorMessage = "Lookup failed. Check your connection."
                    scannedCode = nil
                }
            }
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

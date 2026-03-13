import SwiftUI

struct DateStripView: View {
    @Binding var selectedDate: Date
    let onDateChange: () -> Void

    private let calendar = Calendar.current

    /// The 7 days of the current week containing `selectedDate`
    private var weekDays: [Date] {
        let start = calendar.date(from: calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: selectedDate))!
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }

    private func isSelected(_ date: Date) -> Bool {
        calendar.isDate(date, inSameDayAs: selectedDate)
    }

    private func isToday(_ date: Date) -> Bool {
        calendar.isDateInToday(date)
    }

    private let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "EEE"
        return f
    }()

    private let monthYearFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMMM yyyy"
        return f
    }()

    var body: some View {
        VStack(spacing: 12) {
            // Month + year header with nav arrows
            HStack {
                Button {
                    changeWeek(by: -7)
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Text(monthYearFormatter.string(from: selectedDate))
                    .font(.subheadline.weight(.semibold))

                if !calendar.isDateInToday(selectedDate) {
                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                            selectedDate = Date()
                        }
                        onDateChange()
                    } label: {
                        Text("Today")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.accent)
                    }
                }

                Spacer()

                Button {
                    changeWeek(by: 7)
                } label: {
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }

            // Day pills
            HStack(spacing: 6) {
                ForEach(weekDays, id: \.self) { date in
                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                            selectedDate = date
                        }
                        onDateChange()
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        VStack(spacing: 4) {
                            Text(dayFormatter.string(from: date).prefix(1))
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(isSelected(date) ? .white : .secondary)

                            Text("\(calendar.component(.day, from: date))")
                                .font(.system(size: 14, weight: isSelected(date) ? .bold : .medium, design: .rounded))
                                .foregroundStyle(isSelected(date) ? .white : isToday(date) ? Color.accent : .primary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(isSelected(date) ? Color.accent : Color.clear)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .gesture(
            DragGesture(minimumDistance: 50, coordinateSpace: .local)
                .onEnded { value in
                    if value.translation.width > 80 {
                        changeWeek(by: -7)
                    } else if value.translation.width < -80 {
                        changeWeek(by: 7)
                    }
                }
        )
    }

    private func changeWeek(by days: Int) {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
            selectedDate = calendar.date(byAdding: .day, value: days, to: selectedDate) ?? selectedDate
        }
        onDateChange()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}

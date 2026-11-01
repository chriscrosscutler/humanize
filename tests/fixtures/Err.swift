import SwiftUI

struct ErrorView: View {
    var body: some View {
        VStack {
            Text("Something went wrong")
            Button("Oops, an error occurred. Please try again later.") {}
        }
    }
}

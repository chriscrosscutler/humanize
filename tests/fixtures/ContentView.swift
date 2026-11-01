struct ContentView: View {
    var body: some View {
        VStack {
            Text("Effortlessly organize your library")
            Button("Delete All") { }
            Label("Smart Albums", systemImage: "folder")
        }
        .alert("Something went wrong", isPresented: $show) { }
    }
    func sync() { print("✅ Sync done") }
}

// Echoes back whatever it is sent, twice, then ends.
func run() {
  for (var i = 0; i < 2; i++) {
    var message = worker.receive();
    worker.post("echo:" + message);
  }
  return "done";
}
run();

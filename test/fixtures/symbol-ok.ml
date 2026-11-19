// The same member in a module of its own, to be imported and used from elsewhere.
import "core:fs";

struct Sink {
  private var handle;
  var path;
  var closed;

  func init(file) {
    this.path = file;
    this.handle = fs.file(file, "w");
    this.closed = false;
  }

  func write(text) { this.handle.write(text); }

  func [symbol.dispose]() {
    this.handle.close();
    this.closed = true;
  }
}

export(Sink);

// Sends back the pieces of what it received, so a test can check that a `bytes` value
// nested inside an ordinary value survives the crossing.
import "core:bytes";

var message = worker.receive();

worker.post({
  name: message.name,
  body: message.body.toString(),
  stillBytes: bytes.is(message.body)
});

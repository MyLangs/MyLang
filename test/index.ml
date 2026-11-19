// ============================================================================
//  MyLang2 test suite entry point.
//
//    npm run testing                  (builds, then runs this file)
//    node index.js                    (from the project root, after `npm run build:test`)
//
//  Every *.test.ml file is imported in turn; importing it runs its tests. The totals
//  live in the built-in `test` library, which this file puts into runner mode so that
//  each file's `finish()` aggregates instead of reporting on its own.
//
//  The same files also run through the CLI, which discovers them itself:
//
//    mylang test                      every *.test.ml under ./test
//    mylang test test/language        one directory
//    mylang test --filter defer       only tests whose name contains "defer"
//
//  MYLANG_TEST_VERBOSE=1  print every single test instead of one line per group
//  NO_COLOR=1             disable colours
// ============================================================================

import "core:os";
import "core:coreio";
import "core:test";

test.configure({
  runner: true,
  verbose: os.getenv("MYLANG_TEST_VERBOSE") == "1",
  color: !os.getenv("NO_COLOR")
});

coreio.print("");
coreio.print("━━ Test framework ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
coreio.print("test");
import "./library/test.test.ml";

coreio.print("");
coreio.print("━━ Language ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

coreio.print("literals");
import "./language/literals.test.ml";

coreio.print("operators");
import "./language/operators.test.ml";

coreio.print("variables");
import "./language/variables.test.ml";

coreio.print("control-flow");
import "./language/control-flow.test.ml";

coreio.print("functions");
import "./language/functions.test.ml";

coreio.print("arrays-and-objects");
import "./language/arrays-and-objects.test.ml";

coreio.print("structs");
import "./language/structs.test.ml";

coreio.print("struct-members");
import "./language/struct-members.test.ml";

coreio.print("update");
import "./language/update.test.ml";

coreio.print("enums");
import "./language/enums.test.ml";

coreio.print("errors");
import "./language/errors.test.ml";

coreio.print("defer");
import "./language/defer.test.ml";

coreio.print("iterators");
import "./language/iterators.test.ml";

coreio.print("concurrency");
import "./language/concurrency.test.ml";

coreio.print("modules");
import "./language/modules.test.ml";

coreio.print("imports");
import "./language/imports.test.ml";

coreio.print("security");
import "./language/security.test.ml";

coreio.print("permissions");
import "./language/permissions.test.ml";

coreio.print("");
coreio.print("━━ Libraries ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

coreio.print("strings");
import "./library/strings.test.ml";

coreio.print("arrays");
import "./library/arrays.test.ml";

coreio.print("objects");
import "./library/objects.test.ml";

coreio.print("numbers");
import "./library/numbers.test.ml";

coreio.print("bigint");
import "./library/bigint.test.ml";

coreio.print("json");
import "./library/json.test.ml";

coreio.print("path");
import "./library/path.test.ml";

coreio.print("random");
import "./library/random.test.ml";

coreio.print("uuid");
import "./library/uuid.test.ml";

coreio.print("coreio");
import "./library/coreio.test.ml";

coreio.print("os");
import "./library/os.test.ml";

coreio.print("fs");
import "./library/fs.test.ml";

coreio.print("fs-stream");
import "./library/fs-stream.test.ml";

coreio.print("time");
import "./library/time.test.ml";

coreio.print("collections");
import "./library/collections.test.ml";

coreio.print("iter");
import "./library/iter.test.ml";

coreio.print("runtime");
import "./library/runtime.test.ml";

coreio.print("syncbox");
import "./library/syncbox.test.ml";

coreio.print("events");
import "./library/events.test.ml";

coreio.print("bytes");
import "./library/bytes.test.ml";

coreio.print("binary");
import "./library/binary.test.ml";

coreio.print("validation");
import "./library/validation.test.ml";

coreio.print("compress");
import "./library/compress.test.ml";

coreio.print("archive");
import "./library/archive.test.ml";

coreio.print("crypto");
import "./library/crypto.test.ml";

coreio.print("url");
import "./library/url.test.ml";

coreio.print("http");
import "./library/http.test.ml";

coreio.print("dns");
import "./library/dns.test.ml";

coreio.print("tcp");
import "./library/tcp.test.ml";

coreio.print("udp");
import "./library/udp.test.ml";

coreio.print("tls");
import "./library/tls.test.ml";

coreio.print("ws");
import "./library/ws.test.ml";

coreio.print("process");
import "./library/process.test.ml";

coreio.print("workers");
import "./library/workers.test.ml";

coreio.print("utils");
import "./library/utils.test.ml";

coreio.print("");
coreio.print("━━ Integration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

coreio.print("data between libraries");
import "./integration/data-pipeline.test.ml";

coreio.print("concurrency between libraries");
import "./integration/cross-concurrency.test.ml";

coreio.print("resources and permissions");
import "./integration/resources.test.ml";

coreio.print("protocols");
import "./integration/protocols.test.ml";

coreio.print("language meeting libraries");
import "./integration/language-libraries.test.ml";

coreio.print("encodings across libraries");
import "./integration/encoding-chain.test.ml";

coreio.print("libraries as one mesh");
import "./integration/library-mesh.test.ml";

coreio.print("structs owning resources");
import "./integration/struct-resources.test.ml";

coreio.print("files over http and https");
import "./integration/file-transfer.test.ml";

coreio.print("");
coreio.print("━━ Tools ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

coreio.print("prettier");
import "./tools/prettier.test.ml";

coreio.print("no-colors");
import "./tools/no-colors.test.ml";

coreio.print("server errors");
import "./tools/server-errors.test.ml";

coreio.print("init");
import "./tools/init.test.ml";

var failed = test.summary();

if (failed > 0) {
  os.exit(1);
}

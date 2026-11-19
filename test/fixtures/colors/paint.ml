// Prints through every kind of colour: a colour library, coreio, a hand-made code, and
// a warning from the interpreter itself. Used by test/tools/no-colors.test.ml.
import "core:coreio";
import "core:utils/colors";

coreio.print(colors.red("red"));
coreio.print(colors.bold(colors.green("green")));
coreio.print(coreio.colorize("blue", "blue"));
coreio.print("\x1b[35mmagenta\x1b[0m");
coreio.print("length " + length(colors.cyan("x")));
coreio.print("enabled " + colors.enabled());

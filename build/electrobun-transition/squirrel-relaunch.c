// Relaunch helper for the macOS transition (docs/electrobun-transition.md).
//
// Squirrel.Mac's ShipIt, from the Electron build being replaced, installs the update and then, on
// macOS 11 and later, starts `<app>/Contents/Frameworks/Squirrel.framework/Resources/ShipIt` from
// the *new* bundle to relaunch the app. The Electrobun bundle has no Squirrel, so without this file
// the update installs but the app never comes back. This stands in for that one call: it opens the
// bundle it lives in (or an .app named in its arguments) through Launch Services, and does nothing
// else. Electrobun's own updater never uses it.
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static const char *SUFFIX = "/Contents/Frameworks/Squirrel.framework/Resources/ShipIt";

static int ends_with(const char *value, const char *suffix) {
  size_t value_length = strlen(value);
  size_t suffix_length = strlen(suffix);
  return value_length >= suffix_length && strcmp(value + value_length - suffix_length, suffix) == 0;
}

int main(int argc, char **argv) {
  char bundle[PATH_MAX] = {0};
  for (int index = 1; index < argc; index += 1) {
    const char *argument = argv[index];
    if (strncmp(argument, "file://", 7) == 0) argument += 7;
    size_t length = strlen(argument);
    while (length > 0 && argument[length - 1] == '/') length -= 1;
    if (length > 4 && length < sizeof(bundle) && strncmp(argument + length - 4, ".app", 4) == 0) {
      memcpy(bundle, argument, length);
      bundle[length] = '\0';
      break;
    }
  }
  if (bundle[0] == '\0') {
    char executable[PATH_MAX];
    uint32_t size = sizeof(executable);
    // The path ShipIt started, through the framework's symlinks, so it ends with SUFFIX.
    if (_NSGetExecutablePath(executable, &size) != 0 || !ends_with(executable, SUFFIX)) return 1;
    size_t length = strlen(executable) - strlen(SUFFIX);
    if (length >= sizeof(bundle)) return 1;
    memcpy(bundle, executable, length);
    bundle[length] = '\0';
  }
  // ShipIt waited for the old app to quit before installing, so this opens the new one.
  char *const open_argv[] = {"/usr/bin/open", bundle, NULL};
  execv(open_argv[0], open_argv);
  return 1;
}

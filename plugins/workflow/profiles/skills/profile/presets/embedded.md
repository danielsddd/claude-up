# Preset: embedded

**Signals:** `platformio.ini`, `CMakeLists.txt` with a toolchain file, `*.ioc` (STM32), `sdkconfig` (ESP-IDF), `*.v`/`*.vhd`, `Makefile` with `arm-none-eabi`.

**Relevant skills:** embedded C and C++, RTOS, MCU peripherals, FPGA, electrical engineering, control, debugging, testing.

**Commands to look for:** `pio run`, `pio test`, `cmake --build`, `idf.py build`, host-side unit tests.

**Permissions:** allow builds and host tests; ask before flashing a board (`pio run -t upload`, `idf.py flash`) or changing fuses.

**Extras:** never flash without saying which board and port.

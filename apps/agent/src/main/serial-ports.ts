import type { SerialLink, SerialPorts } from '@counterpay/drivers';
import { SerialPort } from 'serialport';

/** Must match CP_BAUD in firmware/frame-generic/platformio.ini. */
export const SERIAL_BAUD = 460800;

/**
 * USB-serial bridges dev boards use: CH340, CP210x, FTDI, Espressif native USB, and a Raspberry Pi
 * acting as a USB serial gadget (Linux gadget ids). Receipt printers use some of these too.
 */
const USB_SERIAL_VENDORS = new Set(['1a86', '10c4', '0403', '303a', '0525', '1d6b']);

const PROBE_MS = 3_500;

export interface PortInfo {
  path: string;
  label: string;
  usbSerial: boolean;
}

export async function listPorts(): Promise<PortInfo[]> {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    label: (p as { friendlyName?: string }).friendlyName ?? p.manufacturer ?? p.path,
    usbSerial: USB_SERIAL_VENDORS.has((p.vendorId ?? '').toLowerCase()),
  }));
}

function openPort(path: string): Promise<SerialPort> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path, baudRate: SERIAL_BAUD, autoOpen: false });
    port.open((error) => (error ? reject(error) : resolve(port)));
  });
}

function closePort(port: SerialPort): Promise<void> {
  return new Promise((resolve) => (port.isOpen ? port.close(() => resolve()) : resolve()));
}

/**
 * Listens on a port for a Counter Pay board's hello. Never writes, so a receipt printer
 * or scanner on the same kind of USB chip is left alone. The firmware says hello every
 * 2 s until a PC answers.
 */
async function probe(path: string): Promise<boolean> {
  let port: SerialPort;
  try {
    port = await openPort(path);
  } catch {
    return false; // In use by another program, or gone.
  }
  const found = await new Promise<boolean>((resolve) => {
    let text = '';
    const timer = setTimeout(() => resolve(false), PROBE_MS);
    port.on('data', (chunk: Buffer) => {
      text = (text + chunk.toString('latin1')).slice(-2048);
      if (/"t"\s*:\s*"hello"/.test(text)) {
        clearTimeout(timer);
        resolve(true);
      }
    });
  });
  await closePort(port);
  return found;
}

function wrap(port: SerialPort): SerialLink {
  return {
    write: (data) => {
      port.write(typeof data === 'string' ? Buffer.from(data, 'latin1') : Buffer.from(data));
    },
    onData: (handler) => {
      port.on('data', (chunk: Buffer) => handler(new Uint8Array(chunk)));
    },
    onClose: (handler) => {
      port.on('close', () => handler());
    },
    close: () => closePort(port),
  };
}

export const serialPorts: SerialPorts = {
  async detect() {
    for (const candidate of (await listPorts()).filter((p) => p.usbSerial)) {
      if (await probe(candidate.path)) return candidate.path;
    }
    return null;
  },
  async open(path) {
    return wrap(await openPort(path));
  },
};

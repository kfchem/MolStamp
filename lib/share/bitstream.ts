export class BitWriter {
  private bytes: number[] = [];
  private current = 0;
  private bitPos = 0;

  writeBits(value: number, bits: number): void {
    if (bits <= 0) return;
  // Write MSB-first within the given width
    for (let i = bits - 1; i >= 0; i -= 1) {
      const bit = (value >>> i) & 1;
      this.current = (this.current << 1) | bit;
      this.bitPos += 1;
      if (this.bitPos === 8) {
        this.bytes.push(this.current & 0xff);
        this.current = 0;
        this.bitPos = 0;
      }
    }
  }

  writeUnsigned(value: number, bits: number): void {
    if (bits <= 0) return;
    if (value < 0 || value >= 2 ** bits) {
      throw new Error(`Value out of range for ${bits} bits: ${value}`);
    }
    this.writeBits(value, bits);
  }

  writeSigned(value: number, bits: number): void {
    if (bits <= 1) throw new Error("signed must be >=2 bits");
    // two's complement within bits
    const max = 2 ** (bits - 1) - 1;
    const min = -(2 ** (bits - 1));
    if (value < min || value > max) {
      throw new Error(`Signed value out of range for ${bits} bits: ${value}`);
    }
    const twos = value < 0 ? (2 ** bits + value) : value;
    this.writeBits(twos, bits);
  }

  alignToByte(): void {
    if (this.bitPos > 0) {
      this.current <<= (8 - this.bitPos);
      this.bytes.push(this.current & 0xff);
      this.current = 0;
      this.bitPos = 0;
    }
  }

  toUint8Array(): Uint8Array {
    this.alignToByte();
    return new Uint8Array(this.bytes);
  }
}

export class BitReader {
  private offset = 0;
  private bitPos = 0;
  constructor(private readonly data: Uint8Array) {}

  readBits(bits: number): number {
    if (bits <= 0) return 0;
    let result = 0;
    for (let i = 0; i < bits; i += 1) {
      if (this.offset >= this.data.length) {
        throw new Error("Read past end of buffer");
      }
      const byte = this.data[this.offset];
      const bit = (byte >> (7 - this.bitPos)) & 1;
      result = (result << 1) | bit;
      this.bitPos += 1;
      if (this.bitPos === 8) {
        this.bitPos = 0;
        this.offset += 1;
      }
    }
    return result >>> 0;
  }

  readUnsigned(bits: number): number {
    return this.readBits(bits);
  }

  readSigned(bits: number): number {
    const v = this.readBits(bits);
  // interpret two's complement
    const signBit = 1 << (bits - 1);
    if (v & signBit) {
      return v - (1 << bits);
    }
    return v;
  }
}

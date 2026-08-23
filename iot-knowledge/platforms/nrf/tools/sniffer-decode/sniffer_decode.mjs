// src/services/nrf/sniffer/cli.ts
import { readFileSync, writeSync } from "node:fs";

// src/services/nrf/sniffer/nordicBleParser.ts
var ADV_ACCESS_ADDRESS = 2391391958;
var ADV_PDU = {
  0: "ADV_IND",
  1: "ADV_DIRECT_IND",
  2: "ADV_NONCONN_IND",
  3: "SCAN_REQ",
  // or AUX_SCAN_REQ
  4: "SCAN_RSP",
  5: "CONNECT_IND",
  // or AUX_CONNECT_REQ
  6: "ADV_SCAN_IND",
  7: "ADV_EXT_IND",
  // extended: AUX_ADV_IND / AUX_SYNC_IND / AUX_CHAIN_IND / AUX_SCAN_RSP
  8: "AUX_CONNECT_RSP"
};
var ADV_HAS_ADVA = /* @__PURE__ */ new Set([0, 2, 4, 6]);
var LL_CONTROL = {
  0: "LL_CONNECTION_UPDATE_IND",
  1: "LL_CHANNEL_MAP_IND",
  2: "LL_TERMINATE_IND",
  3: "LL_ENC_REQ",
  4: "LL_ENC_RSP",
  5: "LL_START_ENC_REQ",
  6: "LL_START_ENC_RSP",
  7: "LL_UNKNOWN_RSP",
  8: "LL_FEATURE_REQ",
  9: "LL_FEATURE_RSP",
  11: "LL_VERSION_IND",
  12: "LL_REJECT_IND",
  15: "LL_CONNECTION_PARAM_REQ",
  16: "LL_CONNECTION_PARAM_RSP",
  18: "LL_PING_REQ",
  19: "LL_PING_RSP",
  20: "LL_LENGTH_REQ",
  21: "LL_LENGTH_RSP",
  22: "LL_PHY_REQ",
  23: "LL_PHY_RSP",
  24: "LL_PHY_UPDATE_IND"
};
var LL_ERROR = {
  8: "Connection Timeout",
  19: "Remote User Terminated",
  22: "Terminated by Local Host",
  34: "LL Response Timeout",
  40: "Instant Passed",
  61: "MIC Failure",
  62: "Connection Failed to be Established"
};
function phyName(v) {
  return v === 0 ? "1M" : v === 1 ? "2M" : v === 2 ? "Coded" : `0x${v.toString(16)}`;
}
function macLE(buf, off) {
  const b = [];
  for (let i = 5; i >= 0; i--) {
    b.push(buf[off + i].toString(16).padStart(2, "0"));
  }
  return b.join(":");
}
var MAX_PAYLOAD_HEX_BYTES = 255;
function hexCapped(buf, off, len, cap = MAX_PAYLOAD_HEX_BYTES) {
  const end = Math.min(off + cap, off + len, buf.length);
  const parts = [];
  for (let i = off; i < end; i++) {
    parts.push(buf[i].toString(16).padStart(2, "0"));
  }
  const omitted = len - (end - off);
  if (omitted > 0) {
    parts.push(`\u2026 +${omitted} bytes`);
  }
  return parts.join(" ");
}
function decodeLl(ll) {
  const fields = [];
  if (ll.length < 6) {
    return { pduType: "malformed", summary: `LL too short (${ll.length}B)`, fields, len: 0, proto: "LL" };
  }
  const accessAddress = ll.readUInt32LE(0);
  const h0 = ll[4];
  const h1 = ll[5];
  const payOff = 6;
  if (accessAddress === ADV_ACCESS_ADDRESS) {
    const type = h0 & 15;
    const txRandom = (h0 >> 6 & 1) === 1;
    const len2 = h1;
    const name = ADV_PDU[type] ?? `ADV 0x${type.toString(16)}`;
    fields.push({ name: "PDU", value: `${name} (TxAdd ${txRandom ? "Random" : "Public"})` });
    if (type === 5 && ll.length >= payOff + 12) {
      const initA = macLE(ll, payOff);
      const advA = macLE(ll, payOff + 6);
      fields.push({ name: "Initiator", value: initA });
      fields.push({ name: "Advertiser", value: advA });
      return { pduType: name, summary: `CONNECT_IND ${initA} \u2192 ${advA}`, fields, len: len2, proto: "ADV" };
    }
    if (type === 3 && ll.length >= payOff + 12) {
      const scanA = macLE(ll, payOff);
      const advA = macLE(ll, payOff + 6);
      fields.push({ name: "Scanner", value: scanA });
      fields.push({ name: "Advertiser", value: advA });
      return { pduType: name, summary: `SCAN_REQ ${scanA} \u2192 ${advA}`, fields, len: len2, proto: "ADV" };
    }
    if (type === 1 && ll.length >= payOff + 12) {
      const advA = macLE(ll, payOff);
      const targetA = macLE(ll, payOff + 6);
      fields.push({ name: "Advertiser", value: advA });
      fields.push({ name: "Target", value: targetA });
      return { pduType: name, summary: `ADV_DIRECT_IND ${advA} \u2192 ${targetA}`, fields, len: len2, proto: "ADV" };
    }
    if (ADV_HAS_ADVA.has(type) && ll.length >= payOff + 6) {
      const advA = macLE(ll, payOff);
      fields.push({ name: "Advertiser", value: advA });
      return { pduType: name, summary: `${name} from ${advA} (${len2}B)`, fields, len: len2, proto: "ADV" };
    }
    return { pduType: name, summary: `${name} (${len2}B)`, fields, len: len2, proto: "ADV" };
  }
  const llid = h0 & 3;
  const len = h1;
  const aaHex = `0x${accessAddress.toString(16).padStart(8, "0")}`;
  fields.push({ name: "Access Address", value: aaHex });
  if (llid === 3) {
    const opcode = ll.length > payOff ? ll[payOff] : -1;
    const opName = LL_CONTROL[opcode] ?? `LL_CTRL 0x${opcode >= 0 ? opcode.toString(16) : "??"}`;
    fields.push({ name: "Control", value: opName });
    if (opcode === 2 && ll.length > payOff + 1) {
      const reason = ll[payOff + 1];
      const reasonName = LL_ERROR[reason] ?? `0x${reason.toString(16)}`;
      fields.push({ name: "Reason", value: reasonName, isError: reason !== 0 });
      return { pduType: opName, summary: `${opName} reason=${reasonName}`, fields, len, proto: "LL-CTRL" };
    }
    return { pduType: opName, summary: opName, fields, len, proto: "LL-CTRL" };
  }
  if (llid === 1) {
    const proto = len === 0 ? "LL(empty)" : "DATA";
    return { pduType: "LL Data", summary: len === 0 ? "LL Empty PDU" : `LL Data (cont) ${len}B`, fields, len, proto };
  }
  if (llid === 2) {
    return { pduType: "LL Data", summary: `LL Data (start) ${len}B`, fields, len, proto: "DATA" };
  }
  return { pduType: "LL", summary: `LL reserved PDU (${len}B)`, fields, len, proto: "LL" };
}
var META_PREFIX_LEN = 7;
function parseNordicBleRecord(buf, frameNo) {
  if (buf.length < META_PREFIX_LEN + 1) {
    return null;
  }
  const protocolVersion = buf[3];
  const flagsOff = META_PREFIX_LEN;
  if (protocolVersion !== 3 || flagsOff + 10 > buf.length) {
    return null;
  }
  const flagsBlockLen = buf[flagsOff];
  const flags = buf[flagsOff + 1];
  const channel = buf[flagsOff + 2];
  const rssi = buf[flagsOff + 3];
  const timestampUs = buf.readUInt32LE(flagsOff + 6);
  const bleStart = flagsOff + flagsBlockLen;
  if (bleStart > buf.length) {
    return null;
  }
  const crcOk = (flags & 1) === 1;
  const phy = phyName(flags >> 4 & 7);
  const ll = buf.subarray(bleStart);
  const { pduType, summary, fields, len, proto } = decodeLl(ll);
  if (!crcOk) {
    fields.push({ name: "CRC", value: "FAILED", isError: true });
  }
  return {
    frameNo,
    tsMs: timestampUs / 1e3,
    channel,
    rssiDbm: -rssi,
    phy,
    crcOk,
    pduType,
    summary,
    fields,
    pduLen: len,
    proto,
    payloadHex: hexCapped(ll, 4, Math.max(0, ll.length - 4))
    // from the PDU header onward
  };
}
function parseNordicBle(records, linkType) {
  const entries = [];
  let parseErrors = 0;
  let frameNo = 0;
  for (const rec of records) {
    const entry = parseNordicBleRecord(rec, frameNo + 1);
    if (entry) {
      frameNo++;
      entries.push(entry);
    } else {
      parseErrors++;
    }
  }
  let durationMs = entries.length >= 2 && entries[0].tsMs !== void 0 && entries[entries.length - 1].tsMs !== void 0 ? entries[entries.length - 1].tsMs - entries[0].tsMs : void 0;
  if (durationMs !== void 0 && durationMs < 0) {
    durationMs = void 0;
  }
  return { entries, totalFrames: frameNo, parseErrors, durationMs, linkType };
}

// src/services/nrf/sniffer/pcapReader.ts
var LINKTYPE_NORDIC_BLE = 272;
var MAGIC_LE_US = 2712847316;
var MAGIC_LE_NS = 2712812621;
var MAGIC_PCAPNG = 168627466;
function readPcap(buf) {
  if (buf.length < 24) {
    return null;
  }
  const magicLE = buf.readUInt32LE(0);
  const magicBE = buf.readUInt32BE(0);
  let le;
  let nanos;
  if (magicLE === MAGIC_LE_US || magicLE === MAGIC_LE_NS) {
    le = true;
    nanos = magicLE === MAGIC_LE_NS;
  } else if (magicBE === MAGIC_LE_US || magicBE === MAGIC_LE_NS) {
    le = false;
    nanos = magicBE === MAGIC_LE_NS;
  } else if (magicLE === MAGIC_PCAPNG || magicBE === MAGIC_PCAPNG) {
    return null;
  } else {
    return null;
  }
  const u16 = (o) => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
  const u32 = (o) => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
  void u16;
  const linkType = u32(20);
  const records = [];
  let truncated = 0;
  let off = 24;
  while (off + 16 <= buf.length) {
    const tsSec = u32(off);
    const tsUsec = u32(off + 4);
    const inclLen = u32(off + 8);
    const dataStart = off + 16;
    if (inclLen === 0 || dataStart + inclLen > buf.length || inclLen > 65535) {
      truncated++;
      break;
    }
    records.push({ tsSec, tsUsec, data: buf.subarray(dataStart, dataStart + inclLen) });
    off = dataStart + inclLen;
  }
  return { linkType, nanos, records, truncated };
}

// src/services/nrf/sniffer/format.ts
var MERMAID_MAX_EVENTS = 40;
function relTime(ms, base) {
  if (ms === void 0 || base === void 0) {
    return "   --.---";
  }
  const t = Math.max(0, ms - base);
  const m = Math.floor(t / 6e4);
  const s = Math.floor(t % 6e4 / 1e3);
  const msec = Math.floor(t % 1e3);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return m > 0 ? `${p(m)}:${p(s)}.${p(msec, 3)}` : `${p(s)}.${p(msec, 3)}`;
}
function fmtDelta(curr, prev) {
  if (curr === void 0 || prev === void 0) {
    return "  --.-";
  }
  return (curr - prev).toFixed(1).padStart(6);
}
function lifecycleNote(e) {
  switch (e.pduType) {
    case "CONNECT_IND": {
      const initA = e.fields?.find((f) => f.name === "Initiator")?.value;
      const advA = e.fields?.find((f) => f.name === "Advertiser")?.value;
      return `connection starts${initA && advA ? ` (${initA} \u2192 ${advA})` : ""}`;
    }
    case "LL_PHY_UPDATE_IND":
      return "PHY switch requested";
    case "LL_CONNECTION_UPDATE_IND":
      return "connection interval/timing changing";
    case "LL_TERMINATE_IND": {
      const reason = e.fields?.find((f) => f.name === "Reason")?.value;
      return `connection ends${reason ? ` \u2014 reason: ${reason}` : ""}`;
    }
    default:
      return void 0;
  }
}
function formatSniffer(result) {
  const lines = [];
  const base = result.entries[0]?.tsMs;
  lines.push("# BLE over-the-air sniffer decode (nRF Sniffer, what actually transmitted between devices)");
  lines.push(
    `# ${result.totalFrames} frames \xB7 ${result.parseErrors} undecoded` + (result.durationMs !== void 0 ? ` \xB7 span ${Math.round(result.durationMs)} ms` : "")
  );
  if (result.linkType !== void 0 && result.linkType !== LINKTYPE_NORDIC_BLE) {
    lines.push(`# \u26A0 unexpected PCAP link type ${result.linkType} (expected ${LINKTYPE_NORDIC_BLE} = nRF Sniffer)`);
  }
  lines.push("# This is the AIR layer: advertising packets, CONNECT_IND, and link-layer control/data PDUs.");
  lines.push("# We decode the link layer only \u2014 never ATT/L2CAP/SMP. Open the .pcap in Wireshark for that depth.");
  lines.push("#");
  lines.push("# Legend (beginner):");
  lines.push("#   \u0394t(ms) = time since the previous frame (\u2248 the connection interval, once connected)");
  lines.push("#   Ch     = RF channel index \u2014 37/38/39 are the 3 advertising channels, 0-36 are data channels");
  lines.push("#   Proto  = ADV (advertising) \xB7 LL-CTRL (connection control) \xB7 DATA (payload) \xB7 LL(empty) (keep-alive, no data)");
  lines.push("#   CRC    = ok (frame verified) or BAD (radio noise/collision \u2014 ignore that frame's content)");
  lines.push("#");
  lines.push("# Wireshark bridge (expert) \u2014 open the .pcap next to this file and try:");
  lines.push("#   btle                            all BLE link-layer frames");
  lines.push("#   !(btle.data_header.length==0)  hide empty keep-alive PDUs");
  lines.push("#   btle.advertising_address        filter by device address");
  lines.push("#   nordic_ble.channel == 37        filter by RF channel");
  lines.push("#");
  lines.push("# Columns:  No.    Time(rel)    \u0394t(ms)   Ch     RSSI    PHY    Proto      Len   CRC  Info");
  lines.push("#");
  let prevTs;
  for (const e of result.entries) {
    const no = `#${String(e.frameNo).padStart(5)}`;
    const time = relTime(e.tsMs, base);
    const dt = fmtDelta(e.tsMs, prevTs);
    const ch = `ch${String(e.channel).padStart(2)}`;
    const rssi = `${e.rssiDbm}`.padStart(4);
    const phy = e.phy.padEnd(5);
    const proto = e.proto.padEnd(9);
    const len = `${e.pduLen}B`.padStart(5);
    const crc = e.crcOk ? "ok " : "BAD";
    const note = lifecycleNote(e);
    const head = `${no}  ${time}  ${dt}  ${ch}  ${rssi}dBm ${phy} ${proto} ${len} ${crc}  ${e.summary}${note ? `  \u2190 ${note}` : ""}`;
    lines.push(head);
    if (e.fields?.length) {
      for (const f of e.fields) {
        lines.push(`           ${f.isError ? "\u2717 " : "  "}${f.name}: ${f.value}`);
      }
    }
    if (e.payloadHex) {
      lines.push(`           payload: ${e.payloadHex}`);
    }
    prevTs = e.tsMs;
  }
  if (result.entries.length === 0) {
    lines.push("# (no BLE packets decoded \u2014 the dongle may not have seen traffic; check it followed the right device)");
  }
  const mermaid = buildSnifferMermaid(result.entries);
  if (mermaid) {
    lines.push("#");
    lines.push("# --- suggested chat sequence diagram (mermaid) ---");
    lines.push("# Lift the lines below (strip the leading '# ') into a ```mermaid fence when presenting in chat.");
    for (const l of mermaid.split("\n")) {
      lines.push(`# ${l}`);
    }
  }
  return `${lines.join("\n")}
`;
}
function buildSnifferMermaid(entries) {
  if (entries.length === 0) {
    return void 0;
  }
  let centralAddr;
  let peripheralAddr;
  for (const e of entries) {
    if (e.pduType === "CONNECT_IND") {
      centralAddr = e.fields?.find((f) => f.name === "Initiator")?.value;
      peripheralAddr = e.fields?.find((f) => f.name === "Advertiser")?.value;
      break;
    }
  }
  if (!peripheralAddr) {
    for (const e of entries) {
      const advA = e.fields?.find((f) => f.name === "Advertiser")?.value;
      if (advA) {
        peripheralAddr = advA;
        break;
      }
    }
  }
  const lines = ["sequenceDiagram"];
  lines.push(`    participant C as Central${centralAddr ? ` (${centralAddr})` : ""}`);
  lines.push(`    participant P as Peripheral${peripheralAddr ? ` (${peripheralAddr})` : ""}`);
  let runLen = 0;
  let runEmpty = 0;
  let eventCount = 0;
  let truncated = false;
  const flushRun = () => {
    if (runLen === 0) {
      return;
    }
    if (runEmpty === runLen) {
      lines.push(`    Note over C,P: ${runLen} empty keep-alive PDU${runLen > 1 ? "s" : ""}`);
    } else if (runEmpty === 0) {
      lines.push(
        `    Note over C,P: ${runLen} data PDU${runLen > 1 ? "s" : ""} (GATT traffic \u2014 see .pcap in Wireshark for ATT/L2CAP detail)`
      );
    } else {
      lines.push(`    Note over C,P: ${runLen} connection-event PDUs (${runEmpty} empty keep-alive)`);
    }
    runLen = 0;
    runEmpty = 0;
  };
  for (const e of entries) {
    if (truncated) {
      break;
    }
    const collapsible = e.proto === "DATA" || e.proto === "LL(empty)";
    if (collapsible) {
      runLen++;
      if (e.proto === "LL(empty)") {
        runEmpty++;
      }
      continue;
    }
    flushRun();
    if (eventCount >= MERMAID_MAX_EVENTS) {
      truncated = true;
      break;
    }
    switch (e.pduType) {
      case "ADV_IND":
      case "ADV_NONCONN_IND":
      case "ADV_SCAN_IND":
      case "ADV_DIRECT_IND":
        lines.push(`    P->>C: ${e.pduType}`);
        eventCount++;
        break;
      case "SCAN_REQ":
        lines.push("    C->>P: SCAN_REQ");
        eventCount++;
        break;
      case "SCAN_RSP":
        lines.push("    P-->>C: SCAN_RSP");
        eventCount++;
        break;
      case "CONNECT_IND":
        lines.push("    C->>P: CONNECT_IND");
        eventCount++;
        break;
      case "LL_TERMINATE_IND": {
        const reason = e.fields?.find((f) => f.name === "Reason")?.value ?? "unknown";
        lines.push(`    C--xP: LL_TERMINATE_IND (${reason})`);
        eventCount++;
        break;
      }
      default:
        if (e.proto === "LL-CTRL") {
          lines.push(`    C->>P: ${e.pduType}`);
          eventCount++;
        }
    }
  }
  flushRun();
  if (truncated) {
    lines.push("    Note over C,P: (additional lifecycle events truncated \u2014 see .pcap in Wireshark for the full sequence)");
  }
  return lines.join("\n");
}
function decodeSnifferPcap(buf) {
  const pcap = readPcap(buf);
  if (!pcap) {
    const result2 = { entries: [], totalFrames: 0, parseErrors: 0 };
    return {
      text: "# BLE sniffer decode \u2014 could not read the PCAP (not a classic .pcap, or pcapng). Open it in Wireshark.\n",
      result: result2
    };
  }
  const result = parseNordicBle(
    pcap.records.map((r) => r.data),
    pcap.linkType
  );
  return { text: formatSniffer(result), result };
}

// src/services/nrf/sniffer/cli.ts
function main(argv) {
  const flag = (n) => argv.includes(`--${n}`);
  const opt = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  };
  if (flag("help") || flag("h")) {
    console.log("sniffer-decode --in <capture.pcap> [--json]\n\nDecode a Nordic BLE sniffer PCAP into a readable trace.");
    return;
  }
  const emit = (payload, code) => {
    const body = flag("json") ? `${JSON.stringify(payload, null, 2)}
` : `${String(payload.text ?? "")}
`;
    if (flag("json") || code === 0) {
      writeSync(1, body);
    } else {
      writeSync(2, `sniffer-decode: ${payload.reason ?? "failed"}
`);
    }
    process.exitCode = code;
  };
  const input = opt("in");
  if (!input) {
    emit({ status: "bad-input", reason: "--in <capture.pcap> is required" }, 2);
    return;
  }
  let buf;
  try {
    buf = readFileSync(input);
  } catch (e) {
    emit({ status: "bad-input", reason: `could not read ${input}: ${e.message}` }, 2);
    return;
  }
  if (buf.length === 0) {
    emit({ status: "bad-input", reason: `${input} is empty \u2014 no packets were captured` }, 2);
    return;
  }
  try {
    const { text, result } = decodeSnifferPcap(buf);
    emit({ status: "ok", text, totalFrames: result.totalFrames }, 0);
  } catch (e) {
    emit({ status: "decode-failed", reason: e.message }, 3);
  }
}
main(process.argv.slice(2));

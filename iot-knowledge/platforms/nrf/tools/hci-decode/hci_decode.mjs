// src/services/nrf/hci/cli.ts
import { readFileSync, writeSync } from "node:fs";

// src/services/nrf/hci/format.ts
var MERMAID_MAX_EVENTS = 40;
function elapsed(ms) {
  if (ms === void 0) {
    return "     --.---";
  }
  const total = Math.floor(ms);
  const h = Math.floor(total / 36e5);
  const m = Math.floor(total % 36e5 / 6e4);
  const s = Math.floor(total % 6e4 / 1e3);
  const msec = total % 1e3;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(msec, 3)}`;
}
function arrow(type) {
  switch (type) {
    case "CMD":
      return "host \u2192 ctrl ";
    // command issued by the host stack
    case "EVT":
      return "ctrl \u2192 host ";
    // event/response from the controller
    case "ACL_TX":
      return "host \u2192 ctrl ";
    // outbound data
    case "ACL_RX":
      return "ctrl \u2192 host ";
    // inbound data
    case "MON":
      return "app log    ";
    // Zephyr LOG_* line interleaved in the monitor stream
    default:
      return "monitor    ";
  }
}
function formatHci(result) {
  const lines = [];
  lines.push("# HCI Monitor decode (host \u2194 controller traffic, from CONFIG_BT_DEBUG_MONITOR_RTT)");
  lines.push(
    `# ${result.totalFrames} frames \xB7 ${result.parseErrors} parse error(s)` + (result.durationMs !== void 0 ? ` \xB7 span ${Math.round(result.durationMs)} ms` : "")
  );
  lines.push("# Layers: CMD host\u2192ctrl command \xB7 EVT ctrl\u2192host event \xB7 ACL data \xB7 MON app log \xB7 SYS/INDEX monitor meta");
  lines.push("# Columns:  #frame  time(uptime)  direction  TYPE  code  summary");
  lines.push("#");
  for (const e of result.entries) {
    const head = `#${String(e.frameNo).padStart(5)}  ${elapsed(e.elapsedMs)}  ${arrow(e.type)} ${e.type.padEnd(6)} ${e.code.padEnd(10)} ${e.summary}`;
    lines.push(head);
    if (e.decoded?.fields?.length) {
      for (const f of e.decoded.fields) {
        lines.push(`         ${f.isError ? "\u2717 " : "  "}${f.name}: ${f.value}`);
      }
    }
    if (e.payloadHex) {
      lines.push(`           payload: ${e.payloadHex}`);
    }
  }
  if (result.entries.length === 0) {
    lines.push("# (no HCI frames decoded \u2014 capture may be empty or the monitor was not enabled)");
  }
  const mermaid = buildHciMermaid(result.entries);
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
function buildHciMermaid(entries) {
  if (entries.length === 0) {
    return void 0;
  }
  const lines = ["sequenceDiagram"];
  lines.push("    participant H as Host");
  lines.push("    participant Ctrl as Controller");
  let runLen = 0;
  let eventCount = 0;
  let truncated = false;
  let emitted = false;
  const flushRun = () => {
    if (runLen === 0) {
      return;
    }
    lines.push(
      `    Note over H,Ctrl: ${runLen} ACL data packet${runLen > 1 ? "s" : ""} (GATT traffic \u2014 see .btmon in Wireshark for ATT/L2CAP detail)`
    );
    runLen = 0;
    emitted = true;
  };
  for (const e of entries) {
    if (truncated) {
      break;
    }
    if (e.type === "ACL_TX" || e.type === "ACL_RX") {
      runLen++;
      continue;
    }
    if (e.type === "MON" || e.type === "SYS" || e.type === "INDEX" || e.type === "UNKNOWN") {
      continue;
    }
    flushRun();
    if (eventCount >= MERMAID_MAX_EVENTS) {
      truncated = true;
      break;
    }
    if (e.type === "CMD") {
      lines.push(`    H->>Ctrl: ${e.summary.replace(/^TX CMD /, "")}`);
      eventCount++;
      emitted = true;
    } else if (e.type === "EVT") {
      const arrowOp = e.summary.includes("Disconnection Complete") ? "--x" : "-->>";
      lines.push(`    Ctrl${arrowOp}H: ${e.summary.replace(/^RX EVT /, "")}`);
      eventCount++;
      emitted = true;
    }
  }
  flushRun();
  if (truncated) {
    lines.push(
      "    Note over H,Ctrl: (additional lifecycle events truncated \u2014 see .btmon in Wireshark for the full sequence)"
    );
  }
  if (!emitted) {
    return void 0;
  }
  return lines.join("\n");
}

// src/services/nrf/hci/hciParser.ts
var MONITOR_OPCODE = {
  0: "INDEX",
  // NEW_INDEX  — controller registered with name "SDC" etc.
  1: "INDEX",
  // DEL_INDEX  — controller removed
  2: "CMD",
  // HCI Command (host → controller)
  3: "EVT",
  // HCI Event   (controller → host)
  4: "ACL_TX",
  // ACL TX
  5: "ACL_RX",
  // ACL RX
  12: "SYS",
  // SYSTEM_NOTE
  13: "MON"
  // USER_LOGGING — Zephyr LOG_* via BT monitor
};
var HCI_CMD = {
  // Link Control
  1025: "Inquiry",
  1026: "Inquiry Cancel",
  1029: "Create Connection",
  1030: "Disconnect",
  1032: "Accept Connection Request",
  1033: "Reject Connection Request",
  1035: "Link Key Request Reply",
  1037: "PIN Code Request Reply",
  1049: "Remote Name Request",
  // Controller & Baseband
  3073: "Set Event Mask",
  3075: "Reset",
  3077: "Set Event Filter",
  3085: "Write Local Name",
  3091: "Write Scan Enable",
  3098: "Write Authentication Enable",
  3107: "Read Class of Device",
  3108: "Write Class of Device",
  3123: "Host Buffer Size",
  3125: "Read Current IAC LAP",
  3130: "Write Current IAC LAP",
  3141: "Write Default Link Policy",
  3171: "Set Event Mask Page 2",
  3181: "Write LE Host Support",
  // Informational Parameters
  4097: "Read Local Version Information",
  4098: "Read Local Supported Commands",
  4099: "Read Local Supported Features",
  4105: "Read BD ADDR",
  // Status Parameters
  5121: "Read RSSI",
  // LE Controller Commands
  8193: "LE Set Event Mask",
  8194: "LE Read Buffer Size",
  8195: "LE Read Local Supported Features",
  8197: "LE Set Random Address",
  8198: "LE Set Advertising Parameters",
  8199: "LE Read Advertising Channel TX Power",
  8200: "LE Set Advertising Data",
  8201: "LE Set Scan Response Data",
  8202: "LE Set Advertising Enable",
  8203: "LE Set Scan Parameters",
  8204: "LE Set Scan Enable",
  8205: "LE Create Connection",
  8206: "LE Create Connection Cancel",
  8207: "LE Read Filter Accept List Size",
  8208: "LE Clear Filter Accept List",
  8209: "LE Add Device to Filter Accept List",
  8210: "LE Remove Device from Filter Accept List",
  8211: "LE Connection Update",
  8212: "LE Set Host Channel Classification",
  8213: "LE Read Channel Map",
  8214: "LE Read Remote Features",
  8215: "LE Encrypt",
  8216: "LE Rand",
  8217: "LE Enable Encryption",
  8218: "LE Long Term Key Request Reply",
  8219: "LE Long Term Key Request Negative Reply",
  8220: "LE Read Supported States",
  8228: "LE Read Transmit Power",
  8229: "LE Read Local P-256 Public Key",
  8230: "LE Generate DHKey",
  8231: "LE Add Device to Resolving List",
  8233: "LE Clear Resolving List",
  8234: "LE Set Privacy Mode",
  8235: "LE Set Address Resolution Enable",
  8237: "LE Set Resolvable Private Address Timeout",
  8238: "LE Read Maximum Data Length",
  8239: "LE Read PHY",
  8240: "LE Read PHY",
  8241: "LE Set Default PHY",
  8242: "LE Set PHY",
  8246: "LE Set Extended Advertising Parameters",
  8247: "LE Set Extended Advertising Data",
  8248: "LE Set Extended Scan Response Data",
  8249: "LE Set Extended Advertising Enable",
  8254: "LE Read Maximum Advertising Data Length",
  8257: "LE Set Extended Scan Parameters",
  8258: "LE Set Extended Scan Enable",
  8259: "LE Extended Create Connection",
  8270: "LE Set Data Length",
  8288: "LE Read Buffer Size v2",
  8292: "LE Extended Create Connection v2",
  8322: "LE Set Extended Advertising Parameters v2"
};
var HCI_EVT = {
  1: "Inquiry Complete",
  2: "Inquiry Result",
  3: "Connection Complete",
  4: "Connection Request",
  5: "Disconnection Complete",
  6: "Authentication Complete",
  7: "Remote Name Request Complete",
  8: "Encryption Change",
  11: "Read Remote Supported Features Complete",
  12: "Read Remote Version Information Complete",
  14: "Command Complete",
  15: "Command Status",
  16: "Hardware Error",
  19: "Number of Completed Packets",
  26: "Data Buffer Overflow",
  48: "Encryption Key Refresh Complete",
  62: "LE Meta Event",
  255: "Vendor Specific"
};
var LE_META = {
  1: "LE Connection Complete",
  2: "LE Advertising Report",
  3: "LE Connection Update Complete",
  4: "LE Read Remote Features Complete",
  5: "LE Long Term Key Request",
  6: "LE Remote Connection Parameter Request",
  7: "LE Data Length Change",
  8: "LE Read Local P-256 Public Key Complete",
  9: "LE Generate DHKey Complete",
  10: "LE Enhanced Connection Complete",
  11: "LE Directed Advertising Report",
  12: "LE PHY Update Complete",
  13: "LE Extended Advertising Report",
  18: "LE Channel Selection Algorithm",
  25: "LE CIS Established",
  26: "LE CIS Request",
  39: "LE Subrate Change"
};
var HCI_ERROR = {
  0: "Success",
  1: "Unknown HCI Command",
  2: "Unknown Connection Identifier",
  3: "Hardware Failure",
  5: "Authentication Failure",
  6: "PIN or Key Missing",
  7: "Memory Capacity Exceeded",
  8: "Connection Timeout",
  9: "Connection Limit Exceeded",
  11: "Connection Already Exists",
  12: "Command Disallowed",
  13: "Connection Rejected (Resources)",
  14: "Connection Rejected (Security)",
  15: "Connection Rejected (Address)",
  16: "Connection Accept Timeout Exceeded",
  17: "Unsupported Feature/Parameter",
  18: "Invalid HCI Parameters",
  19: "Remote User Terminated Connection",
  20: "Remote Device Terminated (Low Resources)",
  21: "Remote Device Terminated (Power Off)",
  22: "Connection Terminated by Local Host",
  23: "Repeated Attempts",
  24: "Pairing Not Allowed",
  31: "Unspecified Error",
  34: "LL Response Timeout",
  37: "Encryption Mode Not Acceptable",
  40: "Instant Passed",
  41: "Pairing With Unit Key Not Supported",
  42: "Different Transaction Collision",
  61: "Connection Terminated due to MIC Failure",
  62: "Connection Failed to be Established",
  66: "Operation Cancelled by Host"
};
function cmdName(opcode) {
  return HCI_CMD[opcode] ?? `Unknown Command (0x${opcode.toString(16).toUpperCase().padStart(4, "0")})`;
}
function evtBaseName(evtCode) {
  return HCI_EVT[evtCode] ?? `Unknown Event (0x${evtCode.toString(16).toUpperCase().padStart(2, "0")})`;
}
function hciErrorCode(status) {
  return HCI_ERROR[status] ?? `Error 0x${status.toString(16).toUpperCase().padStart(2, "0")}`;
}
function field(name, value, isError = false) {
  return isError ? { name, value, isError: true } : { name, value };
}
function statusField(name, code) {
  const text = hciErrorCode(code);
  return field(name, text, code !== 0);
}
var MAX_PAYLOAD_HEX_BYTES = 255;
function payloadToHex(buf, offset, len) {
  const cap = Math.min(len, MAX_PAYLOAD_HEX_BYTES);
  const end = Math.min(offset + cap, offset + len, buf.length);
  const parts = [];
  for (let i = offset; i < end; i++) parts.push(buf[i].toString(16).padStart(2, "0"));
  const omitted = len - (end - offset);
  if (omitted > 0) parts.push(`\u2026 +${omitted} bytes`);
  return parts.join(" ");
}
function decodeNewIndex(payload, payloadOffset, payloadLen) {
  if (payloadLen >= 16) {
    const name = payload.subarray(payloadOffset + 8, payloadOffset + 16).toString("utf8").replace(/\0/g, "");
    return { summary: `HCI Index: ${name}` };
  }
  return { summary: "HCI Index registered" };
}
function decodeDelIndex() {
  return { summary: "HCI Index removed" };
}
function decodeUserLog(payload, payloadOffset, payloadLen) {
  if (payloadLen < 2) return { summary: "(empty log)" };
  const identLen = payload[payloadOffset + 1];
  const identEnd = payloadOffset + 2 + identLen;
  const ident = payload.subarray(payloadOffset + 2, Math.min(identEnd, payloadOffset + payloadLen)).toString("utf8").replace(/\0/g, "");
  const msg = payload.subarray(Math.min(identEnd, payloadOffset + payloadLen), payloadOffset + payloadLen).toString("utf8").replace(/\0/g, "").trim();
  return { summary: `[${ident}] ${msg}` };
}
function decodeCmd(payload, payloadOffset, payloadLen) {
  if (payloadLen < 3) return { code: "CMD", summary: `TX CMD (${payloadLen}B)` };
  const opcode = payload.readUInt16LE(payloadOffset);
  const paramLen = payload[payloadOffset + 2];
  return {
    code: `0x${opcode.toString(16).toUpperCase().padStart(4, "0")}`,
    summary: `TX CMD ${cmdName(opcode)} (${paramLen}B)`
  };
}
function decodeEvt(payload, payloadOffset, payloadLen) {
  if (payloadLen < 2) return { code: "EVT", summary: `RX EVT (${payloadLen}B)` };
  const evtCode = payload[payloadOffset];
  const evtLen = payload[payloadOffset + 1];
  const paramsOff = payloadOffset + 2;
  const code = `0x${evtCode.toString(16).toUpperCase().padStart(2, "0")}`;
  if (evtCode === 14 && payloadLen >= 5) {
    const numPkts = payload[paramsOff];
    const cmdOpcode = payload.readUInt16LE(paramsOff + 1);
    const status = payloadLen >= 6 ? payload[paramsOff + 3] : 0;
    const name = cmdName(cmdOpcode);
    const statusStr = payloadLen >= 6 ? ` (status: ${hciErrorCode(status)})` : "";
    const fields = [field("Num Packets", numPkts.toString()), field("Command", name)];
    if (payloadLen >= 6) fields.push(statusField("Status", status));
    return {
      code,
      summary: `RX EVT Command Complete ${name}${statusStr}`,
      decoded: { fields }
    };
  }
  if (evtCode === 15 && payloadLen >= 6) {
    const status = payload[paramsOff];
    const numPkts = payload[paramsOff + 1];
    const cmdOpcode = payload.readUInt16LE(paramsOff + 2);
    const name = cmdName(cmdOpcode);
    const fields = [
      statusField("Status", status),
      field("Num Packets", numPkts.toString()),
      field("Command", name)
    ];
    return {
      code,
      summary: `RX EVT Command Status ${name} (status: ${hciErrorCode(status)})`,
      decoded: { fields }
    };
  }
  if (evtCode === 5 && payloadLen >= 6) {
    const status = payload[paramsOff];
    const handle = payload.readUInt16LE(paramsOff + 1) & 4095;
    const reason = payload[paramsOff + 3];
    const fields = [
      statusField("Status", status),
      field("Connection Handle", `0x${handle.toString(16).padStart(4, "0")}`),
      field("Reason", hciErrorCode(reason), reason !== 0)
    ];
    return {
      code,
      summary: `RX EVT Disconnection Complete handle=0x${handle.toString(16).padStart(4, "0")} (status: ${hciErrorCode(status)}, reason: ${hciErrorCode(reason)})`,
      decoded: { fields }
    };
  }
  if (evtCode === 62 && payloadLen >= 3) {
    const sub = payload[paramsOff];
    const subName = LE_META[sub] ?? `LE Subevent 0x${sub.toString(16).padStart(2, "0")}`;
    if ((sub === 1 || sub === 10) && payloadLen >= 6) {
      const status = payload[paramsOff + 1];
      const handle = payload.readUInt16LE(paramsOff + 2) & 4095;
      const fields = [
        field("Subevent", subName),
        statusField("Status", status),
        field("Connection Handle", `0x${handle.toString(16).padStart(4, "0")}`)
      ];
      return {
        code,
        summary: status === 0 ? `RX EVT ${subName} handle=0x${handle.toString(16).padStart(4, "0")} (status: ${hciErrorCode(status)})` : `RX EVT ${subName} (status: ${hciErrorCode(status)})`,
        decoded: { fields }
      };
    }
    if (sub === 3 && payloadLen >= 4) {
      const status = payload[paramsOff + 1];
      return {
        code,
        summary: `RX EVT ${subName} (status: ${hciErrorCode(status)})`,
        decoded: {
          fields: [field("Subevent", subName), statusField("Status", status)]
        }
      };
    }
    if (sub === 12 && payloadLen >= 8) {
      const status = payload[paramsOff + 1];
      const handle = payload.readUInt16LE(paramsOff + 2) & 4095;
      const txPhy = payload[paramsOff + 4];
      const rxPhy = payload[paramsOff + 5];
      const phyStr = (p) => p === 1 ? "1M" : p === 2 ? "2M" : p === 3 ? "Coded" : `${p}`;
      return {
        code,
        summary: `RX EVT ${subName} TX=${phyStr(txPhy)} RX=${phyStr(rxPhy)} (status: ${hciErrorCode(status)})`,
        decoded: {
          fields: [
            field("Subevent", subName),
            statusField("Status", status),
            field("Connection Handle", `0x${handle.toString(16).padStart(4, "0")}`),
            field("TX PHY", phyStr(txPhy)),
            field("RX PHY", phyStr(rxPhy))
          ]
        }
      };
    }
    return {
      code,
      summary: `RX EVT ${subName} (${evtLen}B)`,
      decoded: { fields: [field("Subevent", subName), field("Length", `${evtLen}B`)] }
    };
  }
  return {
    code,
    summary: `RX EVT ${evtBaseName(evtCode)} (${evtLen}B)`,
    decoded: { fields: [field("Event Code", code), field("Length", `${evtLen}B`)] }
  };
}
function decodeAcl(payload, payloadOffset, payloadLen, dir) {
  if (payloadLen < 4) return { code: "ACL", summary: `${dir} ACL (${payloadLen}B)` };
  const hword = payload.readUInt16LE(payloadOffset);
  const handle = hword & 4095;
  const dataLen = payload.readUInt16LE(payloadOffset + 2);
  return {
    code: `h=0x${handle.toString(16).padStart(4, "0")}`,
    summary: `${dir} ACL handle=0x${handle.toString(16).padStart(4, "0")} ${dataLen}B`
  };
}
function parseHci(buffer) {
  const entries = [];
  let offset = 0;
  let parseErrors = 0;
  let frameNo = 0;
  while (offset + 6 <= buffer.length) {
    const dataLen = buffer.readUInt16LE(offset);
    const monOpcode = buffer.readUInt16LE(offset + 2);
    const hdrLen = buffer.readUInt8(offset + 5);
    const extHdrLen = hdrLen;
    const payloadLen = Math.max(0, dataLen - 4 - hdrLen);
    const totalFrame = 2 + dataLen;
    if (dataLen < 4 || offset + totalFrame > buffer.length) {
      parseErrors++;
      offset++;
      continue;
    }
    const extHdrOffset = offset + 6;
    const payloadOffset = extHdrOffset + extHdrLen;
    let elapsedMs;
    if (extHdrLen >= 5 && buffer[extHdrOffset] === 8) {
      const ts32 = buffer.readUInt32LE(extHdrOffset + 1);
      elapsedMs = ts32 / 10;
    }
    const type = MONITOR_OPCODE[monOpcode] ?? "SYS";
    let code = `0x${monOpcode.toString(16).toUpperCase().padStart(4, "0")}`;
    let summary;
    let decoded;
    switch (type) {
      case "INDEX": {
        const decodedRes = monOpcode === 1 ? decodeDelIndex() : decodeNewIndex(buffer, payloadOffset, payloadLen);
        summary = decodedRes.summary;
        code = "hci";
        break;
      }
      case "CMD": {
        const d = decodeCmd(buffer, payloadOffset, payloadLen);
        code = d.code;
        summary = d.summary;
        break;
      }
      case "EVT": {
        const d = decodeEvt(buffer, payloadOffset, payloadLen);
        code = d.code;
        summary = d.summary;
        decoded = d.decoded;
        break;
      }
      case "ACL_TX": {
        const d = decodeAcl(buffer, payloadOffset, payloadLen, "TX");
        code = d.code;
        summary = d.summary;
        break;
      }
      case "ACL_RX": {
        const d = decodeAcl(buffer, payloadOffset, payloadLen, "RX");
        code = d.code;
        summary = d.summary;
        break;
      }
      case "MON": {
        const d = decodeUserLog(buffer, payloadOffset, payloadLen);
        summary = d.summary;
        code = "MON";
        break;
      }
      case "SYS":
      default: {
        if (monOpcode === 12 && payloadLen > 0) {
          const text = buffer.subarray(payloadOffset, payloadOffset + payloadLen).toString("utf8").replace(/\0/g, "").trim();
          summary = text || `(${payloadLen} bytes)`;
        } else {
          summary = `BT Monitor opcode 0x${monOpcode.toString(16).toUpperCase().padStart(2, "0")} (${payloadLen}B)`;
        }
        code = "SYS";
        break;
      }
    }
    entries.push({
      frameNo: ++frameNo,
      elapsedMs,
      type,
      code,
      summary,
      payloadHex: payloadToHex(buffer, payloadOffset, payloadLen),
      payloadLen,
      decoded
    });
    offset += totalFrame;
  }
  const durationMs = entries.length >= 2 && entries[0].elapsedMs !== void 0 && entries[entries.length - 1].elapsedMs !== void 0 ? entries[entries.length - 1].elapsedMs - entries[0].elapsedMs : void 0;
  return { entries, totalFrames: frameNo, parseErrors, durationMs };
}

// src/services/nrf/hci/cli.ts
/*! @license MIT — the btmon decoder is adapted from LogScope, https://github.com/novelbits/logscope */
function main(argv) {
  const flag = (n) => argv.includes(`--${n}`);
  const opt = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  };
  if (flag("help") || flag("h")) {
    console.log("hci-decode --in <capture.btmon> [--json]\n\nDecode a btmon capture into a readable HCI trace.");
    return;
  }
  const emit = (payload, code) => {
    const body = flag("json") ? `${JSON.stringify(payload, null, 2)}
` : `${String(payload.text ?? "")}
`;
    if (flag("json") || code === 0) {
      writeSync(1, body);
    } else {
      writeSync(2, `hci-decode: ${payload.reason ?? "failed"}
`);
    }
    process.exitCode = code;
  };
  const input = opt("in");
  if (!input) {
    emit({ status: "bad-input", reason: "--in <capture.btmon> is required" }, 2);
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
    emit({ status: "bad-input", reason: `${input} is empty \u2014 nothing was captured` }, 2);
    return;
  }
  try {
    const result = parseHci(buf);
    emit(
      {
        status: "ok",
        text: formatHci(result),
        entries: result.entries.length,
        totalFrames: result.totalFrames,
        parseErrors: result.parseErrors
      },
      0
    );
  } catch (e) {
    emit({ status: "decode-failed", reason: e.message }, 3);
  }
}
main(process.argv.slice(2));

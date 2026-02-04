#!/usr/bin/env python3
"""
Test RTT Reliability
--------------------
Stress-tests the nrf_rtt_logger.py script by running it repeatedly.
This helps verify that the J-Link process cleanup and connection logic is robust.

Usage:
    python3 test_rtt_robustness.py --iterations 5 --auto-detect
"""
import argparse
import subprocess
import sys
import time

def main():
    parser = argparse.ArgumentParser(description="Stress test RTT logger")
    parser.add_argument("--iterations", type=int, default=3, help="Number of test runs")
    parser.add_argument("--duration", type=int, default=5, help="Duration per run (sec)")
    parser.add_argument("--auto-detect", action="store_true", help="Auto-detect devices")
    parser.add_argument("--devices", help="Manual device list")
    args = parser.parse_args()

    passes = 0
    fails = 0

    print(f"\n[STRESS TEST] Starting {args.iterations} iterations (duration={args.duration}s)...")
    print("-" * 60)

    logger_script = "nrf_rtt_logger.py"
    # Ensure we run the script from the same directory
    import os
    script_dir = os.path.dirname(os.path.abspath(__file__))
    logger_path = os.path.join(script_dir, logger_script)

    for i in range(1, args.iterations + 1):
        print(f"\nExample Run #{i}/{args.iterations}")
        print("=" * 40)
        
        cmd = ["python3", logger_path, "--capture", "--duration", str(args.duration)]
        if args.auto_detect:
            cmd.append("--auto-detect")
        if args.devices:
            cmd.extend(["--devices", args.devices])
            
        start_time = time.time()
        result = subprocess.run(cmd)
        
        if result.returncode == 0:
            print(f"\n[Run #{i}] scan SUCCESS")
            passes += 1
        else:
            print(f"\n[Run #{i}] scan FAILED (Code {result.returncode})")
            fails += 1
            
        # Optional: slight delay between runs
        time.sleep(2)

    print("\n" + "-" * 60)
    print(f"[SUMMARY] Total: {args.iterations} | Pass: {passes} | Fail: {fails}")
    success_rate = (passes / args.iterations) * 100
    print(f"Reliability: {success_rate:.1f}%")
    
    if fails > 0:
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())

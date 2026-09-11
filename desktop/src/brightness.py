#!/usr/bin/env python3
import sys
import json
import ctypes

def get_frameworks():
    try:
        cg = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
        ds = ctypes.cdll.LoadLibrary('/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices')
        return cg, ds
    except Exception as e:
        sys.stderr.write(f"Error loading frameworks: {e}\n")
        return None, None

def get_displays(cg):
    try:
        max_displays = 16
        displays = (ctypes.c_uint32 * max_displays)()
        count = ctypes.c_uint32()
        cg.CGGetOnlineDisplayList(max_displays, displays, ctypes.byref(count))
        if count.value > 0:
            return [displays[i] for i in range(count.value)]
    except Exception:
        pass
    try:
        return [cg.CGMainDisplayID()]
    except Exception:
        return [1]

def get_brightness(ds, display_id):
    try:
        get_b = ds.DisplayServicesGetBrightness
        get_b.argtypes = [ctypes.c_uint32, ctypes.POINTER(ctypes.c_float)]
        get_b.restype = ctypes.c_int
        b = ctypes.c_float(0.5)
        res = get_b(display_id, ctypes.byref(b))
        return b.value if res == 0 else 0.5
    except Exception:
        return 0.5

def set_brightness(ds, display_id, val):
    try:
        set_b = ds.DisplayServicesSetBrightness
        set_b.argtypes = [ctypes.c_uint32, ctypes.c_float]
        set_b.restype = ctypes.c_int
        return set_b(display_id, ctypes.c_float(val)) == 0
    except Exception:
        return False

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No action specified"}))
        return

    action = sys.argv[1]
    cg, ds = get_frameworks()
    if not cg or not ds:
        print(json.dumps({"error": "Frameworks unavailable"}))
        return

    displays = get_displays(cg)

    if action == "get":
        result = []
        for d in displays:
            b = get_brightness(ds, d)
            result.append({"display": d, "brightness": b})
        print(json.dumps({"success": True, "displays": result}))

    elif action == "set":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "No brightness value provided"}))
            return
        try:
            val = float(sys.argv[2])
            val = max(0.0, min(1.0, val))
        except ValueError:
            print(json.dumps({"error": "Invalid brightness value"}))
            return

        success_all = True
        for d in displays:
            if not set_brightness(ds, d, val):
                success_all = False
        print(json.dumps({"success": success_all, "brightness": val}))

if __name__ == "__main__":
    main()

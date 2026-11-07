export function effectiveDeviceArea(device, devices = {}) {
  return (
    device?.area_id ||
    (device?.parent_device_id ? devices[device.parent_device_id]?.area_id : null) ||
    null
  );
}

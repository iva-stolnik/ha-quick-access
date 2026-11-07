export function subscribeProfiles(connection, onChange) {
  return connection.subscribeMessage(
    onChange,
    { type: "quick_access/subscribe_profiles" },
    { resubscribe: false },
  );
}

export function sendProfileMutation(connection, operation, profile, revision) {
  return connection.sendMessagePromise({
    type: "quick_access/mutate_profile",
    operation,
    profile_id: profile.id,
    revision,
    ...(operation === "delete" ? {} : { profile }),
  });
}

export function resetProfileVisibility(connection, profileId) {
  return connection.sendMessagePromise({
    type: "quick_access/mutate_profile",
    operation: "reset_visibility",
    profile_id: profileId,
  });
}

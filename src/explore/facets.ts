// Which properties get faceted per object type in the explorer. Each must be
// a searchable property of that type.

export const FACET_CONFIG: Record<string, string[]> = {
  person: ["nationality", "watchlist", "role"],
  organization: ["jurisdiction", "org_type", "watchlist"],
  vessel: ["flag", "vessel_type"],
  aircraft: ["operator_name"],
  document: ["source_name"],
  event: ["event_type"],
  location: ["country"],
};

export const TYPE_COLORS: Record<string, string> = {
  person: "#4f9dde",
  organization: "#e0913c",
  vessel: "#5bb98c",
  aircraft: "#b57edc",
  location: "#d76b6b",
  event: "#d9b34a",
  document: "#7d8a99",
};

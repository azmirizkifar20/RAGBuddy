export interface ProjectConfig {
  id: string;
  name: string;
  repository: string;
  paths: string[];
}

export interface ProjectRegistryData {
  projects: ProjectConfig[];
}

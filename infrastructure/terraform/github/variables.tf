variable "github_owner" {
  description = "GitHub user or organisation that owns the repository."
  type        = string
  default     = "kuibinlin"
}

variable "github_repository" {
  description = "Repository name, without the owner."
  type        = string
  default     = "mydeck"
}

variable "required_checks" {
  description = "Status checks that must pass before main can be merged into. These are ci.yml's job ids."
  type        = list(string)
  default     = ["js", "python", "terraform"]

  # Only ci.yml's jobs. deploy-agent.yml is deliberately absent: it is
  # path-filtered, so it does not run on most pull requests, and a required
  # check that never runs blocks the merge forever.
}

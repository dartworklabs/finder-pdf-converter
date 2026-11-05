# Validate the actual parsed workflow policy and the required check inventory.
require 'yaml'

# Refuse workflows whose permissions, triggers, jobs or commands do not match the approved contract.
def validate(path, jobs)
  data = YAML.safe_load(File.read(path))
  triggers = data.fetch('on')
  raise 'unsafe triggers' unless triggers.keys.sort == %w[pull_request workflow_dispatch]
  raise 'unsafe permissions' unless data['permissions'] == { 'contents' => 'read' }
  raise 'missing or extra jobs' unless data.fetch('jobs').keys.sort == jobs.keys.sort
  data['jobs'].each do |name, job|
    raise 'job permissions override' if job.key?('permissions')
    raise 'wrong runner' unless job['runs-on'] == jobs.fetch(name).fetch(:runner)
    steps = job.fetch('steps')
    raise 'skip or failure masking' if job.key?('if') || job.key?('continue-on-error') || steps.any? { |step| step.key?('if') && step['if'] != 'always()' || step.key?('continue-on-error') }
    checkout = steps.find { |s| s['uses']&.start_with?('actions/checkout@') }
    raise 'checkout credentials' unless checkout && checkout.fetch('with', {})['persist-credentials'] == false
    pins = { 'actions/checkout' => '3d3c42e5aac5ba805825da76410c181273ba90b1', 'actions/setup-node' => '949feb2413d6458794dcd2491c4babbbce0c15c1', 'actions/upload-artifact' => 'cf430e030ddbb5b0abf93d22962f4752f3646cd9' }
    steps.select { |s| s['uses'] }.each do |step|
      action, sha = step['uses'].split('@', 2)
      raise 'unreviewed action' unless pins[action] == sha
    end
    commands = steps.map { |s| s['run'] }.compact.join("\n")
    jobs[name][:commands].each { |command| raise "missing #{command}" unless commands.include?(command) }
    raise 'masked failure' if commands.match?(/\|\|\s*true|set \+e|exit 0/)
    node = steps.find { |s| s['uses']&.start_with?('actions/setup-node@') }
    raise 'wrong Node' unless node && node.fetch('with', {})['node-version'] == '26.5.0'
  end
end

portable = ['verification/ci/check.py fast model', 'verification/ci/check.py fast boundaries', 'verification/ci/check.py portable-tests', 'verification/ci/check.py fast review', 'verification/ci/check.py fast progress', 'typescript@7.0.2', '@biomejs/biome@2.6.5', 'verification/ci/check.py shell', 'verification/ci/test_check.py', 'ruff==0.14.14', 'mypy==1.19.1']
native = ['verification/ci/native-probe.sh', 'verification/ci/check.py fast build', 'verification/ci/check.py fast native', 'verification/ci/check.py shell']
validate('.github/workflows/ci.yml', { 'portable' => { runner: 'ubuntu-24.04', commands: portable }, 'native' => { runner: 'macos-15', commands: native } })
validate('.github/workflows/full-backend.yml', { 'full' => { runner: 'macos-15', commands: ['verification/ci/check.py full'] } })
puts 'PASS: parsed workflow policy and required inventory'

// CI for new-monorepo: verify the repo's standards, then build and publish
// container images to Artifactory for the apps a change actually affects.
//
// The affected set comes from Turbo's dependency graph, not path globs — a
// glob cannot know that editing packages/fastify-base requires rebuilding
// every service importing it. `--affected` selects changed packages *and
// their dependents*: verified against this repo, touching only
// packages/fastify-base selects {@repo/fastify-base, server} and correctly
// excludes client.
//
// `--affected` compares against `main` by default, which is wrong on a merge
// request and selects nothing on main itself. TURBO_SCM_BASE (set in Scope)
// overrides that. An unresolvable base is a hard turbo error, not a silent
// empty set, so a bad base fails the build rather than skipping the work.
//
// Scope policy, split because the two halves want different answers:
//
//   Verification  merge request / main / tag / FORCE_BUILD_ALL -> FULL
//                 any other branch build                       -> AFFECTED
//   Images        always AFFECTED (FORCE_BUILD_ALL overrides)
//
// Verification is the gate, so a merge request runs the whole repo. Images
// stay scoped even on main: republishing a dozen untouched services on every
// merge buys nothing, and the commit-SHA tag is immutable regardless.
//
// Repo-wide analysers (knip, syncpack, boundaries, oxlint, oxfmt) ignore the
// scope entirely — they reason about the whole graph, so filtering them does
// not make them faster, it makes them wrong. Knip in particular would report
// every export used only from outside the filter as dead code.
//
// Like the root configs, this file names zero packages. An app is "deployable"
// because it has a Dockerfile, so new apps are picked up with no edit here.

pipeline {
  agent any

  options {
    timestamps()
    timeout(time: 45, unit: 'MINUTES')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
  }

  parameters {
    string(
      name: 'ARTIFACTORY_REGISTRY',
      defaultValue: 'artifactory.example.com',
      description: 'Artifactory Docker registry host (no scheme, no path).'
    )
    string(
      name: 'ARTIFACTORY_REPO',
      defaultValue: 'docker-local',
      description: 'Repository path within the registry.'
    )
    string(
      name: 'ARTIFACTORY_CRED_ID',
      defaultValue: 'artifactory-docker',
      description: 'Jenkins "username with password" credential ID.'
    )
    booleanParam(
      name: 'FORCE_BUILD_ALL',
      defaultValue: false,
      description: 'Ignore the affected set: verify and build every app.'
    )
  }

  environment {
    // turbo.json asks for the interactive TUI; CI needs plain streamed logs.
    TURBO_UI                 = 'stream'
    TURBO_TELEMETRY_DISABLED = '1'
    npm_config_fund          = 'false'
  }

  stages {
    stage('Scope') {
      steps {
        script {
          sh '''
            set -eu
            node --version
            npm --version
            # package.json wants node >=24, but without engine-strict in
            # .npmrc npm only warns. Fail here, in seconds, not later.
            node -e 'const [maj] = process.versions.node.split(".").map(Number);
                     if (maj < 24) { console.error("Node >=24 required, got " + process.version); process.exit(1); }'
          '''

          env.GIT_SHA = sh(script: 'git rev-parse --short=12 HEAD', returnStdout: true).trim()
          env.IS_RELEASE = (env.BRANCH_NAME == 'main' || env.TAG_NAME) ? 'true' : 'false'

          // Turbo diffs against real history. A shallow clone — Jenkins'
          // default in many setups — leaves the base ref unresolvable, which
          // turbo reports as a hard error rather than an empty set.
          if (sh(script: 'git rev-parse --is-shallow-repository', returnStdout: true).trim() == 'true') {
            echo 'Shallow clone detected; fetching full history for the diff base.'
            sh 'git fetch --unshallow --no-tags || true'
          }

          // `--affected` defaults to comparing against `main`, which is wrong
          // on a merge request (compare against its target) and useless on
          // main itself (the tip *is* main, so nothing would ever be
          // selected). TURBO_SCM_BASE overrides it for every turbo call below.
          env.TURBO_SCM_BASE = resolveDiffBase()
          env.RUN_SCOPE = (params.FORCE_BUILD_ALL || env.CHANGE_ID || env.IS_RELEASE == 'true' || !env.TURBO_SCM_BASE)
            ? 'full'
            : 'affected'

          echo "scope=${env.RUN_SCOPE} base=${env.TURBO_SCM_BASE ?: '(none)'} sha=${env.GIT_SHA} release=${env.IS_RELEASE}"
        }
      }
    }

    stage('Install') {
      steps {
        // npm ci, never npm install: the lockfile is the contract, and it
        // refuses to run when package.json has drifted from it.
        sh 'npm ci --no-audit --no-fund'
      }
    }

    stage('Verify') {
      // Repo-wide analysers always run in full, whatever the scope. syncpack,
      // knip and boundaries reason about the entire graph — scoping them
      // does not speed anything meaningful up, it just makes them wrong
      // (knip would report every export outside the filter as dead).
      // oxlint and oxfmt cover the whole repo in about a second.
      stages {
        stage('Repo-wide') {
          parallel {
            stage('Format')       { steps { sh 'npm run format:check' } }
            // lint:ci, not lint: --deny-warnings makes warn-level rules fail.
            stage('Lint')         { steps { sh 'npm run lint:ci' } }
            stage('Dep versions') { steps { sh 'npm run syncpack' } }
            stage('Dead code')    { steps { sh 'npm run knip' } }
            stage('Boundaries')   { steps { sh 'npx turbo boundaries' } }
            stage('Audit') {
              // Production dependencies only: a dev-tree advisory never ships
              // in an image, and failing on those just teaches people to
              // ignore this stage. Soften to critical if one ever wedges CI.
              steps { sh 'npm audit --omit=dev --audit-level=high' }
            }
          }
        }

        stage('Types and tests') {
          // Sequential and together: both drive turbo, and concurrent turbo
          // invocations contend over the same .turbo cache.
          steps {
            script {
              def filter = verifyFilter()
              sh "npx turbo run check-types ${filter} --log-order=grouped"
              // test:coverage, not test: the 80% thresholds live in each
              // workspace's vitest config and only apply under this task.
              sh "npx turbo run test:coverage ${filter} --log-order=grouped"
            }
          }
          post {
            always {
              archiveArtifacts artifacts: '**/coverage/lcov.info',
                               allowEmptyArchive: true,
                               fingerprint: false
            }
          }
        }
      }
    }

    stage('Detect affected apps') {
      steps {
        script {
          def apps = deployableApps(imageFilter())
          env.AFFECTED = apps.collect { "${it.name}:${it.dir}" }.join(',')
          env.AFFECTED_COUNT = apps.size().toString()

          if (apps.isEmpty()) {
            echo 'No deployable app affected — no image to build.'
          } else {
            echo "Affected apps:\n${apps.collect { ' - ' + it.name }.join('\n')}"
          }
        }
      }
    }

    stage('Images') {
      when { expression { env.AFFECTED_COUNT != '0' } }
      steps {
        script {
          def registry = "${params.ARTIFACTORY_REGISTRY}/${params.ARTIFACTORY_REPO}"
          def release = env.IS_RELEASE == 'true'

          if (release) {
            withCredentials([usernamePassword(credentialsId: params.ARTIFACTORY_CRED_ID,
                                              usernameVariable: 'REG_USER',
                                              passwordVariable: 'REG_PASS')]) {
              // The registry host is interpolated by Groovy (not secret); the
              // credentials are left for the shell to expand, so they are
              // never baked into the command string or the build log.
              sh "echo \"\$REG_PASS\" | docker login ${params.ARTIFACTORY_REGISTRY} -u \"\$REG_USER\" --password-stdin"
            }
          }

          def builds = [:]
          for (entry in env.AFFECTED.tokenize(',')) {
            // Declared inside the loop body on purpose: each closure below
            // must capture its own binding. Referencing the loop variable
            // directly would give every parallel branch the last app.
            // Not named `dir`: that shadows the pipeline step of the same name.
            def name = entry.tokenize(':')[0]
            def appPath = entry.tokenize(':')[1]

            builds[name] = {
              // The build context is the repo root: `turbo prune` inside the
              // Dockerfile needs the whole workspace to cut down from.
              def image = "${registry}/${name}"
              def tags = ["${image}:${env.GIT_SHA}"]
              if (release) {
                tags << "${image}:${env.TAG_NAME ?: 'latest'}"
              }

              sh """
                docker build \
                  -f ${appPath}/Dockerfile \
                  ${tags.collect { "-t ${it}" }.join(' ')} \
                  --label org.opencontainers.image.revision=${env.GIT_SHA} \
                  --label org.opencontainers.image.source=${env.GIT_URL ?: ''} \
                  --label org.opencontainers.image.created=\$(date -u +%Y-%m-%dT%H:%M:%SZ) \
                  .
              """

              // Feature branches build but do not publish: that still proves
              // the image assembles, without filling the registry with tags
              // nothing will ever deploy.
              if (release) {
                for (tag in tags) {
                  sh "docker push ${tag}"
                }
              } else {
                echo "Built ${tags[0]} — not pushing from ${env.BRANCH_NAME}."
              }
            }
          }

          parallel builds
        }
      }
      post {
        always {
          script {
            sh "docker logout ${params.ARTIFACTORY_REGISTRY} || true"
            // Remove only this build's tags. Deliberately not `docker image
            // prune`: that also drops the dangling intermediate stages, which
            // are exactly the layer cache the next build wants to reuse.
            for (entry in env.AFFECTED.tokenize(',')) {
              def name = entry.tokenize(':')[0]
              sh "docker image rm -f ${params.ARTIFACTORY_REGISTRY}/${params.ARTIFACTORY_REPO}/${name}:${env.GIT_SHA} || true"
            }
          }
        }
      }
    }
  }

  post {
    cleanup {
      cleanWs(deleteDirs: true, notFailBuild: true)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// The ref to diff against, or null when there is no usable one — in which case
// the caller falls back to a full run. Never return a base that does not
// resolve: turbo would select nothing and the build would "pass" having
// verified and built nothing at all.
String resolveDiffBase() {
  if (env.CHANGE_TARGET) {
    sh "git fetch --no-tags origin +refs/heads/${env.CHANGE_TARGET}:refs/remotes/origin/${env.CHANGE_TARGET}"
    return "origin/${env.CHANGE_TARGET}"
  }
  // A branch build diffs against the whole branch, not just its last commit:
  // HEAD^ would ignore everything but the tip when several commits land at once.
  // On main or a tag, the branch tip *is* origin/main — diffing against it
  // would select nothing. The previous commit is the real base, and it is
  // the right one for a squash merge too.
  if (env.IS_RELEASE != 'true' && refExists('origin/main')) {
    return 'origin/main'
  }
  // Empty, never null: assigning null to an env var stores the string
  // "null", which would then read as a perfectly valid-looking base ref.
  return refExists('HEAD^') ? 'HEAD^' : ''
}

boolean refExists(String ref) {
  return sh(script: "git rev-parse --verify --quiet ${ref} >/dev/null", returnStatus: true) == 0
}

// Verification honours the scope policy: a merge request, main or a tag is a
// gate and gets the whole repo.
String verifyFilter() {
  return env.RUN_SCOPE == 'affected' ? '--affected' : ''
}

// Images are always scoped to what changed, even on main. Verification is the
// gate; rebuilding and republishing a dozen untouched services on every merge
// buys nothing, and the commit-SHA tag stays immutable either way.
String imageFilter() {
  if (params.FORCE_BUILD_ALL || !env.TURBO_SCM_BASE) {
    return ''
  }
  return '--affected'
}

// Packages in scope that ship an image, as [name:, dir:] maps.
List deployableApps(String filter) {
  // `turbo ls --output=json` is marked experimental; if a turbo upgrade ever
  // changes this shape, the parse below fails loudly rather than quietly
  // returning an empty set.
  def emit = 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{' +
             'const j=JSON.parse(s);' +
             'if(!j.packages||!j.packages.items)throw new Error("unexpected turbo ls output");' +
             'for(const p of j.packages.items)console.log(p.name+":"+p.path)})'

  def raw = sh(
    script: "npx turbo ls ${filter} --output=json | node -e '${emit}'",
    returnStdout: true
  ).trim()

  // Plain `for`, not `.each`: closures that call pipeline steps are the
  // classic way to trip Jenkins' CPS serialisation.
  def apps = []
  for (line in raw.tokenize('\n')) {
    def parts = line.tokenize(':')
    def name = parts[0]
    def path = parts.size() > 1 ? parts[1] : ''
    // Having a Dockerfile is what makes a package deployable. No list to keep
    // in sync, and packages/* are skipped for free.
    if (path && fileExists("${path}/Dockerfile")) {
      apps << [name: name, dir: path]
    }
  }
  return apps
}

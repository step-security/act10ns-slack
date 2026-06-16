import * as core from '@actions/core'
import * as yaml from 'js-yaml'
import {ConfigOptions, send} from './slack'
import {existsSync, readFileSync} from 'fs'
import {env} from 'process'
import axios, {isAxiosError} from 'axios'
import * as fs from 'node:fs'

async function validateSubscription(): Promise<void> {
  const eventPath = env.GITHUB_EVENT_PATH
  let repoPrivate
  if (eventPath && fs.existsSync(eventPath)) {
    const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
    repoPrivate = eventData?.repository?.private
  }

  const upstream = 'act10ns/slack'
  const action = env.GITHUB_ACTION_REPOSITORY
  const docsUrl = 'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions'

  core.info('')
  core.info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m')
  core.info(`Secure drop-in replacement for ${upstream}`)
  if (repoPrivate === false) core.info('\u001b[32m\u2713 Free for public repositories\u001b[0m')
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`)
  core.info('')

  if (repoPrivate === false) return

  const serverUrl = env.GITHUB_SERVER_URL || 'https://github.com'
  const body: Record<string, string> = {action: action || ''}
  if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl
  const repository = env.GITHUB_REPOSITORY ?? ''

  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${repository}/actions/maintained-actions-subscription`,
      body,
      {timeout: 3000}
    )
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      core.error('\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m')
      core.error(`\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`)
      process.exit(1)
    }
    core.info('Timeout or API not reachable. Continuing to next step.')
  }
}

async function run(): Promise<void> {
  try {
    await validateSubscription()
    // debug output of environment variables and event payload
    const sensitiveKeyPattern = /token|secret|key|password|webhook|credential/i
    for (const k of Object.keys(process.env).sort((a, b) => a.localeCompare(b))) {
      const value = sensitiveKeyPattern.test(k) ? '***' : process.env[k]
      core.debug(`${k} = ${value}`)
    }
    const event = process.env.GITHUB_EVENT_PATH as string
    const readEvent = (): object => JSON.parse(readFileSync(event, 'utf8'))
    core.debug(JSON.stringify(readEvent()))

    const configFile = core.getInput('config', {required: false})
    let config: ConfigOptions = {}
    try {
      core.info(`Reading config file ${configFile}...`)
      if (existsSync(configFile)) {
        config = yaml.load(readFileSync(configFile, 'utf-8'), {schema: yaml.FAILSAFE_SCHEMA}) as ConfigOptions
      } else if (configFile !== '.github/slack.yml') {
        core.warning(`Config file '${configFile}' not found. Make sure the repository is checked out before this step.`)
      }
    } catch (error) {
      if (error instanceof Error) core.info(error.message)
    }
    core.debug(yaml.dump(config))

    const url = core.getInput('webhook-url', {required: false}) || (process.env.SLACK_WEBHOOK_URL as string)
    const jobName = process.env.GITHUB_JOB as string
    const jobStatus = core.getInput('status', {required: true}).toUpperCase()
    const jobSteps = JSON.parse(core.getInput('steps', {required: false}) || '{}')
    const jobMatrix = JSON.parse(core.getInput('matrix', {required: false}) || '{}')
    const jobInputs = JSON.parse(core.getInput('inputs', {required: false}) || '{}')
    const channel = core.getInput('channel', {required: false})
    const message = core.getInput('message', {required: false})
    core.debug(`jobName: ${jobName}, jobStatus: ${jobStatus}`)
    core.debug(`channel: ${channel}, message: ${message}`)
    core.debug(`jobMatrix: ${JSON.stringify(jobMatrix)}`)
    core.debug(`jobInputs: ${JSON.stringify(jobInputs)}`)

    if (url) {
      const channels = channel ? channel.split(/[\s,]+/).filter(Boolean) : ['']
      for (const ch of channels) {
        await send(url, jobName, jobStatus, jobSteps, jobMatrix, jobInputs, ch || undefined, message, config)
        core.info(`Sent ${jobName} status of ${jobStatus} to Slack${ch ? ` (${ch})` : ''}!`)
      }
    } else {
      core.warning('No "SLACK_WEBHOOK_URL"s env or "webhook-url" input configured. Skip.')
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()

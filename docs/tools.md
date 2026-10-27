# Tool catalog

Generated from the built server by `node scripts/smoke.mjs --write-catalog`.

Project-bound tools require an absolute `projectPath` to an existing saved `.band` project. `gb_open_project` takes `path` instead. Query MCP `tools/list` for complete argument schemas.

| Tool | Purpose | Requires projectPath |
| --- | --- | --- |
| `gb_check_permissions` | Check permissions | — |
| `gb_ui_state` | Inspect UI state | — |
| `gb_screenshot` | Screenshot GarageBand | — |
| `gb_launch` | Launch GarageBand | — |
| `gb_new_project` | New project | — |
| `gb_open_project` | Open project | — |
| `gb_save_project` | Save project | Yes |
| `gb_close_project` | Close project | Yes |
| `gb_list_projects` | List open projects | — |
| `gb_transport_state` | Read transport | Yes |
| `gb_play` | Play | Yes |
| `gb_stop` | Stop | Yes |
| `gb_record` | Record | Yes |
| `gb_toggle_cycle` | Toggle cycle | Yes |
| `gb_toggle_metronome` | Toggle metronome | Yes |
| `gb_toggle_count_in` | Toggle count-in | Yes |
| `gb_undo` | Undo | Yes |
| `gb_redo` | Redo | Yes |
| `gb_go_to_beginning` | Go to beginning | Yes |
| `gb_set_playhead` | Set playhead position | Yes |
| `gb_add_software_instrument_track` | Add software instrument track | Yes |
| `gb_add_track` | Add track (typed) | Yes |
| `gb_delete_selected_track` | Delete selected track | Yes |
| `gb_list_tracks` | List tracks | Yes |
| `gb_select_track` | Select track | Yes |
| `gb_set_track_instrument` | Set track instrument | Yes |
| `gb_mute_selected_track` | Mute selected track | Yes |
| `gb_solo_selected_track` | Solo selected track | Yes |
| `gb_set_track_mute` | Set track mute | Yes |
| `gb_set_track_solo` | Set track solo | Yes |
| `gb_list_regions` | List regions | Yes |
| `gb_move_region` | Move region by bars or between tracks | Yes |
| `gb_play_note` | Play a note | Yes |
| `gb_play_chord` | Play a chord | Yes |
| `gb_play_sequence` | Play a sequence | Yes |
| `gb_play_song` | Play a multi-layer song | Yes |
| `gb_record_sequence` | Record a sequence | Yes |
| `gb_send_cc` | Send MIDI CC | Yes |
| `gb_pitch_bend` | Pitch bend | Yes |
| `gb_all_notes_off` | All notes off (panic) | — |
| `gb_get_tempo` | Get project tempo | Yes |
| `gb_set_tempo` | Set project tempo | Yes |
| `gb_set_track_volume` | Set track volume | Yes |
| `gb_set_track_pan` | Set track pan | Yes |
| `gb_set_master_volume` | Set master volume | Yes |
| `gb_toggle_smart_controls` | Toggle Smart Controls | Yes |
| `gb_list_smart_controls` | List Smart Controls | Yes |
| `gb_set_smart_control` | Set Smart Control | Yes |
| `gb_set_smart_switch` | Set Smart Controls switch | Yes |
| `gb_set_track_volume_db` | Set track volume in dB | Yes |
| `gb_add_volume_automation` | Draw volume automation on a fresh copy | Yes |
| `gb_search_loops` | Search Apple Loops | Yes |
| `gb_add_loop` | Add loop to project | Yes |
| `gb_import_midi` | Import a MIDI file | — |
| `gb_imported_events` | Get imported events | — |
| `gb_play_imported` | Play imported MIDI | Yes |
| `gb_record_imported` | Record imported MIDI layer | Yes |
| `gb_search_freesound` | Search Freesound samples | — |
| `gb_download_sample` | Download a Freesound sample | — |
| `gb_export_song` | Export song to disk | Yes |
